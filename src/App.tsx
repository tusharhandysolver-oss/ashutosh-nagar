/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { User, Task, Project, SystemSettings, AppNotification, UserRole, TaskStage, LeaveRequest, CalendarEvent } from "./types";
import DashboardView from "./components/DashboardView";
import KanbanView from "./components/KanbanView";
import CalendarView from "./components/CalendarView";
import ClientCasesView from "./components/ClientCasesView";
import AttendanceLogsView from "./components/AttendanceLogsView";
import ChatbotView from "./components/ChatbotView";
import TaskModal from "./components/TaskModal";
import { motion, AnimatePresence } from "motion/react";
import { createClient, Provider, SupabaseClient } from "@supabase/supabase-js";

import { 
  BarChart3, 
  Calendar as CalendarIcon, 
  CheckSquare, 
  LayoutDashboard, 
  Plus, 
  User as UserIcon, 
  Bell, 
  LogOut, 
  Sparkles,
  ShieldCheck,
  Users,
  Mail,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Lock,
  FolderPlus,
  RefreshCw,
  Info,
  Target,
  Briefcase,
  Clock,
  ChevronRight,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
  Scale,
  Settings,
  Camera
  ,Bot
  ,X
} from "lucide-react";

const SESSION_STORAGE_KEY = "legal_app_session_user";

function loadStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistUser(user: User | null) {
  try {
    if (user) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable (private browsing, etc.) - session just won't persist
  }
}

async function readApiJson(response: Response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(
      response.url.includes("/api/")
        ? "Authentication server returned a web page instead of API data. Please restart or redeploy the server."
        : "The server returned an invalid response."
    );
  }
}

async function getSupabaseBrowserConfig() {
  // Prefer browser-safe build-time values. This avoids a guaranteed 404 on
  // static/Vite-only deployments that do not run the Express API server.
  const embeddedUrl = import.meta.env.VITE_SUPABASE_URL;
  const embeddedKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (embeddedUrl && embeddedKey) return { url: embeddedUrl, publishableKey: embeddedKey };

  try {
    const response = await fetch("/api/auth/config", { headers: { Accept: "application/json" } });
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const config = await readApiJson(response);
      if (response.ok && config.url && config.publishableKey) return config;
    }
  } catch {
    // Static deployments do not have the Express config endpoint. Use the
    // browser-safe values embedded by Vite at build time instead.
  }

  throw new Error("Supabase Auth is not configured in this deployment. Add SUPABASE_URL and SUPABASE_ANON_KEY, then rebuild.");
}

let supabaseBrowserClient: SupabaseClient | null = null;
async function getSupabaseBrowserClient() {
  if (supabaseBrowserClient) return supabaseBrowserClient;
  const config = await getSupabaseBrowserConfig();
  supabaseBrowserClient = createClient(config.url, config.publishableKey);
  return supabaseBrowserClient;
}

const CASE_PAPERS_BUCKET = "Documents";
const casePaperRef = (path: string, name: string) =>
  `supabase://${CASE_PAPERS_BUCKET}/${path}#${encodeURIComponent(name)}`;

function parseCasePaperRef(value: string) {
  const currentPrefix = `supabase://${CASE_PAPERS_BUCKET}/`;
  const legacyPrefix = "supabase://case-papers/";
  const prefix = value.startsWith(currentPrefix) ? currentPrefix : value.startsWith(legacyPrefix) ? legacyPrefix : "";
  if (!prefix) return null;
  const [path, encodedName] = value.slice(prefix.length).split("#");
  return { path, name: decodeURIComponent(encodedName || path.split("/").pop() || "Document") };
}

function appUserFromSupabase(authUser: any): User {
  const metadata = authUser.user_metadata || {};
  return {
    id: authUser.id,
    name: metadata.name || metadata.full_name || authUser.email?.split("@")[0] || "User",
    email: authUser.email || "",
    role: "Team Member",
    department: metadata.department || "Legal Counsel",
    avatar: metadata.avatar_url,
    createdAt: authUser.created_at || new Date().toISOString()
  };
}

export default function App() {
  // Authentication & session state
  const [currentUser, setCurrentUser] = useState<User | null>(() => loadStoredUser());
  const [isLoggedIn, setIsLoggedIn] = useState(() => loadStoredUser() !== null);
  const oauthCallbackStarted = useRef(false);
  
  // Auth flow states
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpRole, setSignUpRole] = useState<"Admin" | "Manager" | "Team Member">("Team Member");
  const [signUpDepartment, setSignUpDepartment] = useState("Legal Counsel");
  const [signUpTermsAccepted, setSignUpTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [signUpError, setSignUpError] = useState("");
  const [signUpSuccess, setSignUpSuccess] = useState("");

  // Login form states
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);

  // App core database state
  const [usersList, setUsersList] = useState<User[]>([]);
  const [tasksList, setTasksList] = useState<Task[]>([]);
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [notificationsList, setNotificationsList] = useState<AppNotification[]>([]);
  const [leavesList, setLeavesList] = useState<LeaveRequest[]>([]);
  const [eventsList, setEventsList] = useState<CalendarEvent[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({
    reminderInDays: 3,
    enableEmailNotifications: true,
    enableUrgentAlerts: true,
    autoRiskAnalysis: true,
    eventReminderMinutesBefore: 10
  });
  const [reminderMinutesInput, setReminderMinutesInput] = useState("10");
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const notifiedEventReminderIds = useRef<Set<string>>(new Set());
  const hasLoadedNotificationsOnce = useRef(false);

  // UI state controllers
  const [currentView, setCurrentView] = useState<"Dashboard" | "Kanban" | "Calendar" | "ClientCases" | "Attendance" | "Chatbot">("Dashboard");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showNotificationsDropdown, setShowNotificationsDropdown] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileRole, setProfileRole] = useState<UserRole>("Team Member");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [quickCreateStage, setQuickCreateStage] = useState<TaskStage>("Case Intake");
  const [celebration, setCelebration] = useState<{ title: string; message: string; id: number } | null>(null);
  const celebrationTimerRef = useRef<number | null>(null);

  // New task form fields
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<"Critical" | "High" | "Medium" | "Low">("Medium");
  const [newTaskStage, setNewTaskStage] = useState<TaskStage>("Case Intake");
  const [newTaskDueDate, setNewTaskDueDate] = useState("2026-07-20");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");
  const [newTaskProject, setNewTaskProject] = useState("");
  const [newTaskTags, setNewTaskTags] = useState("");
  const [newTaskHours, setNewTaskHours] = useState("8");
  const [newTaskIsBillable, setNewTaskIsBillable] = useState(true);
  const [newTaskHourlyRate, setNewTaskHourlyRate] = useState("250");
  const [newTaskClientApproval, setNewTaskClientApproval] = useState<"Approved" | "Pending Review" | "Not Required">("Not Required");
  const [newTaskMatterCode, setNewTaskMatterCode] = useState("");
  const [createTaskError, setCreateTaskError] = useState("");

  function triggerCelebration(title: string, message: string) {
    if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
    setCelebration({ title, message, id: Date.now() });
    celebrationTimerRef.current = window.setTimeout(() => setCelebration(null), 3600);
  }

  useEffect(() => () => {
    if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
  }, []);

  // Periodical automatic triggers for reminder checking
  useEffect(() => {
    if (isLoggedIn) {
      fetchDatabase();
      const interval = setInterval(() => {
        fetchNotificationsOnly();
      }, 8000); // Poll notifications every 8 seconds
      return () => clearInterval(interval);
    }
  }, [isLoggedIn, currentUser?.id]);

  useEffect(() => {
    if (isLoggedIn || (!window.location.hash.includes("access_token") && !window.location.search.includes("code="))) return;
    if (oauthCallbackStarted.current) return;
    oauthCallbackStarted.current = true;
    getSupabaseBrowserClient().then(async (client) => {
      const code = new URLSearchParams(window.location.search).get("code");
      const { data, error } = code
        ? await client.auth.exchangeCodeForSession(code)
        : await client.auth.getSession();
      if (error) throw error;
      if (!data.session) return;
      const res = await fetch("/api/auth/oauth-profile", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({accessToken:data.session.access_token}) });
      let user: User;
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && contentType.includes("application/json")) {
        const payload = await readApiJson(res);
        user = payload.user;
      } else {
        // Static deployments do not expose the Express profile endpoint. The
        // Google OAuth session is already verified by Supabase, so create the
        // local UI profile from that trusted Auth user and sign in directly.
        user = appUserFromSupabase(data.session.user);
      }
      setCurrentUser(user); setIsLoggedIn(true); persistUser(user); setNewTaskAssignee(user.id); window.history.replaceState({}, "", window.location.pathname);
    }).catch((error) => setLoginError(error instanceof Error ? error.message : "Social sign-in could not be completed."));
  }, []);

  async function fetchDatabase() {
    try {
      const [uRes, tRes, pRes, nRes, sRes, lvRes, evRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/tasks"),
        fetch("/api/projects"),
        fetch(`/api/notifications?userId=${currentUser?.id || ""}`),
        fetch("/api/settings"),
        fetch("/api/leaves"),
        fetch("/api/events")
      ]);

      if (uRes.ok) setUsersList(await uRes.json());
      if (tRes.ok) setTasksList(await tRes.json());
      if (pRes.ok) setProjectsList(await pRes.json());
      if (nRes.ok) applyFreshNotifications(await nRes.json());
      if (sRes.ok) {
        const fresh = await sRes.json();
        setSystemSettings(fresh);
        setReminderMinutesInput(String(fresh.eventReminderMinutesBefore ?? 10));
      }
      if (lvRes.ok) setLeavesList(await lvRes.json());
      if (evRes.ok) setEventsList(await evRes.json());
    } catch (e) {
      console.error("Database connection failure:", e);
    }
  }

  // Maps a notification's fixed emoji/label prefix (set server-side) to a
  // human title for the popup, and strips that prefix plus any trailing
  // "(id)" tag from the body text. Falls through to a generic title for
  // anything that doesn't match a known prefix, so new notification types
  // added later still pop instead of silently doing nothing.
  const PUSH_NOTIFICATION_PREFIXES: Array<[string, string]> = [
    ["⏰ EVENT REMINDER: ", "Event reminder"],
    ["✈️ LEAVE REQUEST: ", "New leave request"],
    ["✈️ LEAVE DECISION: ", "Leave request update"],
    ["📋 NEW TASK ASSIGNED: ", "New task assigned"],
    ["🔔 TASK UPDATED: ", "Task updated"],
    ["⏱️ TIMER STARTED: ", "Timer started"],
    ["⏱️ TIMER PAUSED: ", "Timer paused"],
    ["✅ TASK COMPLETED: ", "Task completed"],
    ["💬 COMMENT ADDED: ", "New comment"]
  ];

  // Shared by the initial load and the 8s poll: diffs incoming notifications
  // against what's already on screen and, for any brand-new one, fires a
  // native browser Notification popup (if permission was granted) in
  // addition to the in-app bell - this is what makes leave requests, leave
  // decisions, task assignments, and event reminders actually pop up for a
  // user with the tab open in the background, not just show in the bell.
  function applyFreshNotifications(fresh: AppNotification[]) {
    const isFirstLoad = !hasLoadedNotificationsOnce.current;
    const canPop = typeof Notification !== "undefined" && Notification.permission === "granted";
    fresh.forEach((n) => {
      const alreadySeen = notifiedEventReminderIds.current.has(n.id);
      notifiedEventReminderIds.current.add(n.id);
      // Skip popping on the very first load of a session - otherwise every
      // pre-existing notification would re-pop the moment the tab opens,
      // instead of only genuinely new ones found on later polls.
      if (isFirstLoad || alreadySeen || !canPop) return;
      const match = PUSH_NOTIFICATION_PREFIXES.find(([prefix]) => n.message.startsWith(prefix));
      const title = match ? match[1] : "Notification";
      const body = (match ? n.message.slice(match[0].length) : n.message).replace(/\s*\((?:evt|TSK|not)-[\w-]+\)$/, "");
      try { new Notification(title, { body }); } catch { /* ignore */ }
    });
    hasLoadedNotificationsOnce.current = true;
    setNotificationsList(fresh);
  }

  async function fetchNotificationsOnly() {
    if (!currentUser) return;
    try {
      const res = await fetch(`/api/notifications?userId=${currentUser.id}`);
      if (res.ok) {
        applyFreshNotifications(await res.json());
      }
    } catch (error) {
      console.error(error);
    }
  }

  // Authentication controllers
  async function handleLogin(email: string, password = "", isQuickShortcut = false) {
    setLoginError("");
    setAuthLoading(true);

    try {
      const client = await getSupabaseBrowserClient();
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw error;
      if (!data.session || !data.user) throw new Error("Please confirm your email before signing in.");
      const user = appUserFromSupabase(data.user);
      setCurrentUser(user);
      setIsLoggedIn(true);
      persistUser(user);
      setNewTaskAssignee(user.id);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Unable to sign in.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSocialOAuth(provider: Provider) {
    setLoginError(""); setSignUpError(""); setAuthLoading(true);
    try { const client=await getSupabaseBrowserClient(); const {error}=await client.auth.signInWithOAuth({provider,options:{redirectTo:window.location.origin}}); if(error) throw error;
    } catch(e:any) { const msg=e?.message || "Social sign-in failed."; setLoginError(msg); setSignUpError(msg); setAuthLoading(false); }
  }

  async function handleSignUp() {
    setSignUpError("");
    setSignUpSuccess("");
    setAuthLoading(true);

    if (!signUpName.trim() || !signUpEmail.trim() || !signUpPassword.trim()) {
      setSignUpError("Please fill out all required fields.");
      setAuthLoading(false);
      return;
    }

    if (signUpPassword.length < 6) {
      setSignUpError("Password must be at least 6 characters.");
      setAuthLoading(false);
      return;
    }

    if (!signUpTermsAccepted) {
      setSignUpError("You must accept the Terms & Conditions before signing up.");
      setAuthLoading(false);
      return;
    }

    try {
      const client = await getSupabaseBrowserClient();
      const { data, error } = await client.auth.signUp({
        email: signUpEmail.trim().toLowerCase(),
        password: signUpPassword,
        options: {
          emailRedirectTo: window.location.origin,
          data: { name: signUpName.trim(), department: "Legal Counsel" }
        }
      });
      if (error) throw error;
      if (!data.user) throw new Error("Supabase did not create the account.");

      if (!data.session) {
        setSignUpSuccess("Account created. Please open the confirmation email, confirm your address, then sign in.");
        setSignUpPassword("");
        return;
      }

      // Supabase Auth now has the account, but the app's own "users" table
      // (assignees, attendance, tasks all key off it) does not - that write
      // has to go through the backend, the same way the OAuth callback below
      // does it. Skipping this call was the actual bug: it let signup report
      // success and log the user in locally while no row ever reached
      // "users", so the new account was invisible everywhere else in the app.
      let user: User;
      try {
        const res = await fetch("/api/auth/oauth-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: data.session.access_token }) });
        const contentType = res.headers.get("content-type") || "";
        if (res.ok && contentType.includes("application/json")) {
          const payload = await readApiJson(res);
          user = payload.user;
        } else {
          user = appUserFromSupabase(data.user);
        }
      } catch {
        user = appUserFromSupabase(data.user);
      }

      setSignUpSuccess("Registration successful! Logging you in...");
      setTimeout(() => {
        setCurrentUser(user); setIsLoggedIn(true); persistUser(user); setNewTaskAssignee(user.id);
        setSignUpName(""); setSignUpEmail(""); setSignUpPassword(""); setSignUpTermsAccepted(false); setSignUpError(""); setSignUpSuccess(""); setAuthMode("login");
      }, 900);
    } catch (e) {
      setSignUpError(e instanceof Error ? e.message : "Unable to create account.");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogOut() {
    setCurrentUser(null);
    setIsLoggedIn(false);
    setSelectedTask(null);
    setShowNotificationsDropdown(false);
    persistUser(null);
  }

  function openProfile() {
    if (!currentUser) return;
    setProfileName(currentUser.name);
    setProfilePhone(currentUser.phone || "");
    setProfileRole(currentUser.role);
    setProfileAvatar(currentUser.avatar || "");
    setProfileError("");
    setShowProfileModal(true);
  }

  function handleProfileAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileError("Please choose an image file.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setProfileError("Image must be smaller than 8MB.");
      return;
    }
    setProfileError("");

    // Downscale + re-encode to JPEG so the stored avatar stays a few dozen KB
    // instead of multi-MB, regardless of the original photo's resolution.
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 320;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setProfileAvatar(reader.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setProfileAvatar(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => setProfileError("Could not read that image file.");
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || !profileName.trim()) return setProfileError("Username is required.");
    setProfileSaving(true);
    setProfileError("");
    try {
      const res = await fetch(`/api/users/${currentUser.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-User-Id": currentUser.id },
        body: JSON.stringify({ name: profileName, phone: profilePhone, role: profileRole, avatar: profileAvatar })
      });
      const rawBody = await res.text();
      let data: any;
      try {
        data = JSON.parse(rawBody);
      } catch {
        throw new Error(res.ok ? "Unexpected response from server." : `Server error (${res.status}). Please try again.`);
      }
      if (!res.ok) throw new Error(data.error || "Unable to update profile.");
      setCurrentUser(data);
      persistUser(data);
      setUsersList((prev) => prev.map((user) => user.id === data.id ? data : user));
      setShowProfileModal(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Unable to update profile.");
    } finally {
      setProfileSaving(false);
    }
  }

  // Permit managers to quickly shift system simulated perspective roles
  function handleShiftRoleSimulation(newRole: UserRole) {
    if (!currentUser) return;
    const updatedUser = {
      ...currentUser,
      role: newRole,
      department: newRole === "Admin" ? "Operations" : newRole === "Manager" ? "Engineering" : "Engineering"
    };
    setCurrentUser(updatedUser);
    
    // Auto sync back to user list on server for data correctness
    fetch(`/api/users`)
      .then(r => r.json())
      .then(users => {
        const exist = users.find((u: any) => u.id === currentUser.id);
        if (exist) {
          fetch(`/api/users/${currentUser.id}`, {
            method: "POST", // Simple roles updates
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: newRole })
          }).then(() => fetchDatabase());
        }
      });
  }

  // Create Task Flow
  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    setCreateTaskError("");

    if (!newTaskTitle.trim()) {
      setCreateTaskError("Task Title is required.");
      return;
    }

    const payload = {
      title: newTaskTitle,
      description: newTaskDesc,
      priority: newTaskPriority,
      stage: newTaskStage,
      dueDate: `${newTaskDueDate}T18:00:00Z`,
      assignedTo: newTaskAssignee || currentUser?.id,
      projectId: newTaskProject || projectsList[0]?.id || "prj-1",
      tags: newTaskTags.split(",").map(t => t.trim()).filter(Boolean),
      estimatedHours: Number(newTaskHours),
      isBillable: newTaskIsBillable,
      hourlyRate: Number(newTaskHourlyRate),
      clientApprovalStatus: newTaskClientApproval,
      matterCode: newTaskMatterCode,
      createdBy: currentUser?.id
    };

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const createdTask: Task = await res.json();
        setTasksList((current) => [createdTask, ...current.filter((task) => task.id !== createdTask.id)]);
        triggerCelebration("Task created!", `“${createdTask.title}” has been created successfully.`);
        // Reset states
        setNewTaskTitle("");
        setNewTaskDesc("");
        setNewTaskTags("");
        setNewTaskHours("8");
        setNewTaskIsBillable(true);
        setNewTaskHourlyRate("250");
        setNewTaskClientApproval("Not Required");
        setNewTaskMatterCode("");
        setShowCreateTaskModal(false);
        void fetchDatabase(); // Reconcile the remaining dashboard data in the background.
      } else if (res.status === 401) {
        handleLogOut();
      } else {
        const d = await res.json().catch(() => null);
        setCreateTaskError(d?.error || "Failed to create task.");
      }
    } catch (error) {
      setCreateTaskError("Task dispatcher service unreachable.");
    }
  }

  // Update single field updates for modals, Kanban drag-and-drops
  async function handleUpdateTask(taskId: string, fieldsToUpdate: Partial<Task>) {
    const previousTask = tasksList.find((task) => task.id === taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...fieldsToUpdate,
          editorId: currentUser?.id,
          editorName: currentUser?.name
        })
      });

      if (res.ok) {
        const freshTask = await res.json();
        const wasComplete = previousTask?.status === "Completed" || previousTask?.stage === "Completed";
        const isComplete = freshTask.status === "Completed" || freshTask.stage === "Completed";
        
        // Update list
        setTasksList((prev) => prev.map((t) => (t.id === taskId ? freshTask : t)));
        
        // Update modal state if active
        if (selectedTask && selectedTask.id === taskId) {
          setSelectedTask(freshTask);
        }
        if (!wasComplete && isComplete) {
          triggerCelebration("Case completed!", freshTask.title ? `${freshTask.title} is now complete.` : "The task is now complete.");
        }
        
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleUploadCasePaper(projectId: string, taskId: string, file: File) {
    const allowed = new Set([
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain", "image/jpeg", "image/png", "image/webp"
    ]);
    if (!allowed.has(file.type)) return { ok: false, error: "Choose a PDF, Word, Excel, text, JPG, PNG, or WebP file." };
    if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Files must be 5 MB or smaller to conserve storage." };
    const task = tasksList.find((item) => item.id === taskId && item.projectId === projectId);
    if (!task) return { ok: false, error: "The selected task does not belong to this case." };

    try {
      const client = await getSupabaseBrowserClient();
      const safeName = file.name.normalize("NFKD").replace(/[^\w.,'!&$@=;:+?() -]/g, "_").replace(/\s+/g, "-");
      const objectPath = `${projectId}/${taskId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await client.storage.from(CASE_PAPERS_BUCKET).upload(objectPath, file, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false
      });
      if (uploadError) {
        if (/bucket not found/i.test(uploadError.message)) {
          throw new Error("The Documents bucket was not found in the configured Supabase project.");
        }
        throw uploadError;
      }

      const attachment = casePaperRef(objectPath, file.name);
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachments: [...(task.attachments || []), attachment],
          editorId: currentUser?.id,
          editorName: currentUser?.name
        })
      });
      if (!response.ok) {
        await client.storage.from(CASE_PAPERS_BUCKET).remove([objectPath]);
        throw new Error("The document was uploaded but could not be linked to the task.");
      }
      const freshTask = await response.json();
      setTasksList((previous) => previous.map((item) => item.id === taskId ? freshTask : item));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "The document could not be uploaded." };
    }
  }

  async function handleOpenCasePaper(value: string) {
    const reference = parseCasePaperRef(value);
    if (!reference) return;
    const client = await getSupabaseBrowserClient();
    const { data, error } = await client.storage.from(CASE_PAPERS_BUCKET).createSignedUrl(reference.path, 60);
    if (error) throw error;
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function handlePlayTimerInline(task: Task) {
    try {
      const res = await fetch(`/api/tasks/${task.id}/play`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser?.id, userName: currentUser?.name })
      });
      if (res.ok) {
        const freshTask = await res.json();
        setTasksList((prev) => prev.map((t) => (t.id === task.id ? freshTask : t)));
        if (selectedTask && selectedTask.id === task.id) {
          setSelectedTask(freshTask);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handlePauseTimerInline(task: Task) {
    try {
      const res = await fetch(`/api/tasks/${task.id}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser?.id, userName: currentUser?.name })
      });
      if (res.ok) {
        const freshTask = await res.json();
        setTasksList((prev) => prev.map((t) => (t.id === task.id ? freshTask : t)));
        if (selectedTask && selectedTask.id === task.id) {
          setSelectedTask(freshTask);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  // User list updates (Admins Only)
  async function handleAddUser(userFields: { name: string; email: string; role: UserRole; department: string }) {
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userFields)
      });
      if (res.ok) {
        fetchDatabase();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to register new coworker.");
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleRemoveUser(id: string) {
    if (!confirm("Are you sure you want to remove this user from organization access?")) return;
    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchDatabase();
      }
    } catch (error) {
      console.error(error);
    }
  }

  // Admin Project spawning
  async function handleCreateProject(pFields: { 
    name: string; 
    description: string;
    clientName: string;
    matterCode: string;
    practiceArea: string;
    status: "Active" | "On Hold" | "Closed";
    budget: number;
  }): Promise<boolean> {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pFields)
      });
      if (res.ok) {
        const createdProject: Project = await res.json();
        setProjectsList((current) => [...current.filter((project) => project.id !== createdProject.id), createdProject]);
        triggerCelebration("Case created!", `“${createdProject.name}” has been created successfully.`);
        void fetchDatabase();
        return true;
      }
      return false;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  async function handleUpdateProject(
    projectId: string,
    pFields: { 
      name?: string; 
      description?: string;
      clientName?: string;
      matterCode?: string;
      practiceArea?: string;
      status?: "Active" | "On Hold" | "Closed";
      budget?: number;
    }
  ): Promise<boolean> {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pFields)
      });
      if (res.ok) {
        fetchDatabase();
        return true;
      }
      return false;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  // Alarm constraints update
  async function handleSaveSettings(sFields: Partial<SystemSettings>) {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sFields)
      });
      if (res.ok) {
        const fresh = await res.json();
        setSystemSettings(fresh);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleCreateEvent(fields: { title: string; description: string; dueDate: string; time: string; assigneeIds: string[] }) {
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, createdBy: currentUser?.id })
      });
      if (res.ok) {
        const created = await res.json();
        setEventsList((prev) => [...prev, created]);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleRequestNotificationPermission() {
    if (typeof Notification === "undefined") return;
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleUpdateLeaveStatus(leaveId: string, status: "Approved" | "Rejected") {
    try {
      const res = await fetch(`/api/leaves/${leaveId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminName: currentUser?.name || "Sarah Jenkins" })
      });
      if (res.ok) {
        fetchDatabase();
      }
    } catch (error) {
      console.error(error);
    }
  }

  // Notifications operations
  async function handleMarkNotificationRead(id: string) {
    try {
      const res = await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      if (res.ok) {
        setNotificationsList((prev) => 
          prev.map((n) => n.id === id ? { ...n, readStatus: true } : n)
        );
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function handleMarkAllNotificationsRead() {
    try {
      const res = await fetch("/api/notifications/read-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser?.id })
      });
      if (res.ok) {
        setNotificationsList((prev) => prev.filter((n) => n.userId !== currentUser?.id));
      }
    } catch (e) {
      console.error(e);
    }
  }

  function handleOpenQuickCreateKanban(stage: TaskStage) {
    setNewTaskStage(stage);
    setQuickCreateStage(stage);
    
    // Set first project and user as helper triggers
    if (projectsList.length > 0) setNewTaskProject(projectsList[0].id);
    if (usersList.length > 0) setNewTaskAssignee(currentUser?.id || usersList[0].id);

    setShowCreateTaskModal(true);
  }

  const unreadNotificationsCount = notificationsList.filter((n) => !n.readStatus).length;

  // Render Login / Sign Up Card if sessions not validated yet
  if (!isLoggedIn || !currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-950 via-slate-900 to-blue-950 flex items-center justify-center p-4 selection:bg-blue-800 selection:text-white antialiased font-sans relative overflow-hidden">
        {/* Decorative ambient glow orbs */}
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-blue-800/30 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-blue-500/20 blur-3xl pointer-events-none" />
        <div className="absolute top-1/3 right-1/4 h-64 w-64 rounded-full bg-sky-400/10 blur-3xl pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-md rounded-3xl bg-white/95 backdrop-blur-2xl border border-white/60 text-slate-800 p-6 sm:p-8 shadow-2xl shadow-black/40 space-y-5 sm:space-y-6"
        >
          <div className="text-center space-y-3 flex flex-col items-center">
            <img src="/firm-logo.jpeg" alt="Ashutosh Nagar & Associates Advocates" className="login-firm-logo" />
            <p className="text-sm text-slate-500 max-w-xs mx-auto leading-relaxed pt-1">
              Your firm's case management portal.
            </p>
          </div>

          {/* Tab Selection Switch */}
          <div className="relative flex bg-slate-100/80 rounded-xl p-1 mb-2">
            <motion.div
              className="absolute inset-y-1 w-[calc(50%-4px)] rounded-lg bg-white shadow-sm"
              animate={{ x: authMode === "login" ? 4 : "calc(100% + 4px)" }}
              transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
            />
            <button
              type="button"
              onClick={() => { setAuthMode("login"); setSignUpError(""); setLoginError(""); }}
              className={`relative z-10 flex-1 py-2.5 text-xs uppercase tracking-wider font-bold text-center rounded-lg transition-colors cursor-pointer ${
                authMode === "login" ? "text-blue-900" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setAuthMode("signup"); setSignUpError(""); setLoginError(""); }}
              className={`relative z-10 flex-1 py-2.5 text-xs uppercase tracking-wider font-bold text-center rounded-lg transition-colors cursor-pointer ${
                authMode === "signup" ? "text-blue-900" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              Register
            </button>
          </div>

          {authMode === "login" ? (
            /* SIGN IN FORM */
            <div className="space-y-4">
              <form onSubmit={(e) => { e.preventDefault(); handleLogin(loginEmail, loginPassword); }} className="space-y-4">
                <div>
                  <label className="text-xs uppercase font-bold tracking-widest text-slate-500">Email</label>
                  <div className="relative mt-1">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                      <Mail className="h-4 w-4" />
                    </span>
                    <input
                      type="email"
                      placeholder="you@firm.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="w-full rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-800 focus:outline-hidden focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase font-bold tracking-widest text-slate-500">Password</label>
                  <div className="relative mt-1">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                      <Lock className="h-4 w-4" />
                    </span>
                    <input
                      type={showLoginPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="w-full rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-10 py-3 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-800 focus:outline-hidden focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword(!showLoginPassword)}
                      aria-label={showLoginPassword ? "Hide password" : "Show password"}
                      title={showLoginPassword ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {loginError && <p className="text-xs text-rose-600 font-bold text-center">{loginError}</p>}

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full rounded-xl bg-gradient-to-r from-blue-700 to-cyan-600 hover:from-blue-800 hover:to-cyan-700 py-3 text-sm font-bold text-white transition-all hover:shadow-lg active:scale-98 cursor-pointer flex items-center justify-center gap-2 shadow-xs"
                >
                  {authLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                  <span>Sign In</span>
                </button>
              </form>

              {/* Google OAuth trigger */}
              <div className="space-y-3 pt-4 border-t border-slate-100 text-sm">
                <button
                  type="button"
                  onClick={() => handleSocialOAuth("google")}
                  className="group w-full rounded-2xl bg-white border border-slate-200 hover:border-blue-300 py-3.5 hover:bg-blue-50/40 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-3 text-slate-700 font-bold cursor-pointer shadow-xs hover:shadow-md"
                >
                  <span className="h-7 w-7 rounded-full bg-white border border-slate-100 shadow-xs flex items-center justify-center"><svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.39Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.38l-3.24-2.53c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.61A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.39 13.92A6.02 6.02 0 0 1 6.07 12c0-.67.11-1.32.32-1.92V7.47H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.53l3.35-2.61Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.47l3.35 2.61C7.18 7.71 9.39 5.95 12 5.95Z"/></svg></span>
                  <span>Continue with Google</span>
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all" />
                </button>
              </div>
            </div>
          ) : (
            /* SIGN UP FORM */
            <div className="space-y-4">
              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className="text-xs uppercase font-bold tracking-widest text-slate-500">Name</label>
                  <div className="relative mt-1">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                      <UserIcon className="h-4 w-4" />
                    </span>
                    <input
                      type="text"
                      placeholder="John Doe"
                      value={signUpName}
                      onChange={(e) => setSignUpName(e.target.value)}
                      className="w-full rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-800 focus:outline-hidden focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="text-xs uppercase font-bold tracking-widest text-slate-500">Email</label>
                  <div className="relative mt-1">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                      <Mail className="h-4 w-4" />
                    </span>
                    <input
                      type="email"
                      placeholder="you@firm.com"
                      value={signUpEmail}
                      onChange={(e) => setSignUpEmail(e.target.value)}
                      className="w-full rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-800 focus:outline-hidden focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="text-xs uppercase font-bold tracking-widest text-slate-500">Password</label>
                  <div className="relative mt-1">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                      <Lock className="h-4 w-4" />
                    </span>
                    <input
                      type={showSignUpPassword ? "text" : "password"}
                      placeholder="At least 6 characters"
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value)}
                      className="w-full rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-10 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-800 focus:outline-hidden focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignUpPassword(!showSignUpPassword)}
                      aria-label={showSignUpPassword ? "Hide password" : "Show password"}
                      title={showSignUpPassword ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showSignUpPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Terms and Conditions custom trigger */}
                <div className="pt-2">
                  <div className="flex items-start gap-3 bg-slate-50/70 p-3.5 rounded-xl border border-slate-150/70">
                    <button
                      type="button"
                      onClick={() => setSignUpTermsAccepted(!signUpTermsAccepted)}
                      className={`h-5 w-5 rounded-md flex items-center justify-center border transition-all cursor-pointer shrink-0 mt-0.5 ${
                        signUpTermsAccepted
                          ? "bg-blue-900 border-blue-900 text-white"
                          : "bg-white border-slate-300 hover:border-blue-800"
                      }`}
                    >
                      {signUpTermsAccepted && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                    </button>
                    <div className="text-xs text-slate-600 leading-relaxed font-medium">
                      I agree to the{" "}
                      <button
                        type="button"
                        onClick={() => setShowTermsModal(true)}
                        className="text-blue-900 hover:text-blue-900 font-bold underline transition-colors cursor-pointer inline-flex items-center gap-0.5"
                      >
                        Terms & Conditions
                      </button>
                    </div>
                  </div>
                </div>

                {signUpError && <p className="text-xs text-rose-600 font-bold text-center bg-rose-50 p-2.5 rounded-xl border border-rose-100">{signUpError}</p>}
                {signUpSuccess && <p className="text-xs text-emerald-600 font-bold text-center bg-emerald-50 p-2.5 rounded-xl border border-emerald-100">{signUpSuccess}</p>}

                <button
                  type="button"
                  onClick={handleSignUp}
                  disabled={authLoading || !signUpTermsAccepted}
                  className="w-full rounded-xl bg-gradient-to-r from-blue-700 to-cyan-600 hover:from-blue-800 hover:to-cyan-700 py-3 text-sm font-bold text-white transition-all hover:shadow-lg active:scale-98 cursor-pointer flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
                >
                  {authLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                  <span>Create Account</span>
                </button>
              </div>
            </div>
          )}
          <p className="border-t border-slate-100 pt-4 text-center text-xs font-medium text-slate-500">
            <span className="mr-1" aria-hidden="true">🧡</span>
            Made with love by Handysolver © 2026
          </p>
        </motion.div>

        {/* 10-CLAUSE HIGH-FIDELITY TERMS & CONDITIONS MODAL */}
        <AnimatePresence>
          {showTermsModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[110] p-3 sm:p-4 font-sans selection:bg-blue-800 selection:text-white">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                transition={{ duration: 0.2 }}
                className="bg-white border border-slate-200 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
              >
                {/* Modal Header */}
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-amber-50 text-blue-900 rounded-xl border border-amber-100/60">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-black text-slate-900">Terms & Conditions</h2>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Last updated June 29, 2026</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTermsModal(false)}
                    aria-label="Close"
                    title="Close"
                    className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-all cursor-pointer shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Modal Content - Scrollable terms list */}
                <div className="p-6 overflow-y-auto space-y-5 text-slate-700 text-xs leading-relaxed max-h-[55vh]">
                  
                  {/* Alert box matching user design */}
                  <div className="bg-amber-50/50 border border-amber-100/80 p-4 rounded-xl flex items-start gap-3">
                    <Info className="h-4 w-4 text-blue-800 shrink-0 mt-0.5" />
                    <p className="text-[11px] font-semibold text-blue-950">
                      Please read these terms before registering a tenant workspace. Registration requires explicit acceptance.
                    </p>
                  </div>

                  <p className="text-slate-500 font-medium">
                    These Terms and Conditions govern access to and use of the Ashutosh Nagar & Associates practice management and docket platform by a registered organization and its authorized users.
                  </p>

                  <div className="space-y-4 pt-1">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm mb-1">1. Acceptance of these terms</h3>
                      <p className="text-slate-500">
                        By registering or using a practice workspace, you confirm that you have read and accepted these Terms and Conditions and that you are authorized to accept them for your organization.
                      </p>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-900 text-sm mb-1">2. Workspace accounts</h3>
                      <p className="text-slate-500">
                        You are responsible for accurate registration information, protecting administrator credentials, and all activity performed through your workspace. Notify Ashutosh Nagar & Associates promptly if you believe an account has been compromised.
                      </p>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-900 text-sm mb-1">3. Permitted use</h3>
                      <p className="text-slate-500">
                        Ashutosh Nagar & Associates portal may be used for lawful litigation management, candidate client screens, docket tracking, billable hour auditing, and legal counsel collaboration. You must not use the service to violate applicable law, violate attorney-client privilege, or access another tenant's confidential records.
                      </p>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-900 text-sm mb-1">4. Candidates and privacy</h3>
                      <p className="text-slate-500">
                        Your organization is responsible for providing required notices, obtaining appropriate consent for case recordings, storage, and automated dockets updates, in accordance with applicable privacy and data-protection laws.
                      </p>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-900 text-sm mb-1">5. Customer content</h3>
                      <p className="text-slate-500">
                        You retain responsibility for client records, court briefs, dockets, and files uploaded to your workspace. You confirm that you have the legal rights and permissions required to provide and store that content in the service.
                      </p>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-900 text-sm mb-1">6. AI-assisted results</h3>
                      <p className="text-slate-500">
                        Briefs generators, case intelligence, and automatic court-date triggers are decision-support tools and may contain errors. Your organization must apply independent human professional judgment and must not rely on automated output as the sole basis for legal representation or docket decisions.
                      </p>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-900 text-sm mb-1">7. Service availability</h3>
                      <p className="text-slate-500">
                        We aim to keep our practice management infrastructure reliable and available. While we aim to keep our portal secure, high-frequency database replication or third-party court API downtime may happen. Uninterrupted or error-free operation is not guaranteed.
                      </p>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-900 text-sm mb-1">8. Suspension and termination</h3>
                      <p className="text-slate-500">
                        Access may be suspended or terminated when these terms are violated, the service is misused, security is at risk, or continued access could cause harm to Ashutosh Nagar & Associates, its customers, or legal partners.
                      </p>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-900 text-sm mb-1">9. Disclaimers and responsibility</h3>
                      <p className="text-slate-500">
                        Our software is provided on an as-available basis. To the extent permitted by law, your organization remains responsible for its filings, legal compliance, client advice, and use of platform outputs.
                      </p>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-900 text-sm mb-1">10. Changes to these terms</h3>
                      <p className="text-slate-500">
                        These terms may be updated as the service evolves. Material changes will be communicated through the service or another reasonable channel. Continued use after the effective date of updated terms constitutes acceptance.
                      </p>
                    </div>
                  </div>

                  {/* Help Desk box matching user UI */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 text-slate-600 mt-2">
                    <p className="font-semibold text-slate-800 text-xs mb-1">Questions about these terms?</p>
                    <p className="text-[11px] text-slate-500 leading-normal">
                      Contact your Ashutosh Nagar & Associates firm representative before registering or continuing to use the service.
                    </p>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="p-6 border-t border-slate-150/70 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 stroke-[3]" />
                    <span className="text-xs font-semibold text-slate-600">Secure TLS 1.3 encrypted consent</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowTermsModal(false)}
                      className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 bg-white hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSignUpTermsAccepted(true);
                        setShowTermsModal(false);
                      }}
                      className="px-5 py-2 rounded-xl bg-gradient-to-r from-blue-700 to-cyan-600 hover:from-blue-800 hover:to-cyan-700 text-xs font-bold text-white transition-all shadow-xs cursor-pointer"
                    >
                      I Agree & Accept Terms
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const getViewLabel = (view: string) => {
    const labels: Record<string, string> = {
      Dashboard: "Dashboard",
      Kanban: "Case Kanban",
      Calendar: "Team Calendar",
      ClientCases: "Client Cases",
      Attendance: "Attendance Logs"
      ,Chatbot: "AI Bot"
    };
    return labels[view] || view;
  };

  // Active logged in layout frame
  return (
    <div className={`legal-app min-h-screen flex selection:bg-blue-800 selection:text-white antialiased font-sans ${darkMode ? "dark" : ""}`}>
      
      {/* 1. iOS IPADOS SIDEBAR NAVIGATION PANELS (Desktop only) */}
      <aside className={`legal-sidebar hidden md:flex ${sidebarCollapsed ? "w-[92px]" : "w-[280px]"} shrink-0 m-4 mr-2 bg-white border border-slate-200/70 rounded-[28px] soft-shadow flex-col justify-between py-6 transition-all duration-300`}>

        {/* Top Logo and menus */}
        <div className="space-y-7 flex flex-col items-stretch">

          {/* iOS Style Logo */}
          <div className={`flex items-center ${sidebarCollapsed ? "justify-center px-3" : "px-5"} py-1`}>
            <img src="/firm-logo-sidebar.png" alt="Ashutosh Nagar & Associates Advocates" className={`sidebar-firm-logo ${sidebarCollapsed ? "sidebar-firm-logo-collapsed" : ""}`} />
          </div>

          {/* iOS Style primary Action Button (Delegate Task) */}
          <div className="px-4">
            <button
              onClick={() => {
                setNewTaskStage("Case Intake");
                if (projectsList.length > 0) setNewTaskProject(projectsList[0].id);
                if (usersList.length > 0) setNewTaskAssignee(usersList[0].id);
                setShowCreateTaskModal(true);
              }}
              className="w-full bg-gradient-to-r from-blue-700 to-cyan-600 hover:from-blue-800 hover:to-cyan-700 hover:shadow-lg active:scale-[0.98] active:opacity-95 text-white rounded-full py-3 px-3 flex items-center justify-center gap-1.5 text-sm font-bold transition-all shadow-xs cursor-pointer"
              aria-label="Create Task"
              title="Create Task"
            >
              <Plus className="h-4 w-4" />
              {!sidebarCollapsed && <span>Create Task</span>}
            </button>
          </div>

          {/* Menus list */}
          <div className="space-y-4">
            <div>
              <span className={`${sidebarCollapsed ? "hidden" : "block"} text-xs font-black tracking-wider uppercase text-slate-400/85 px-6 mb-2 font-display`}>
                Menu
              </span>
              <nav className="space-y-1 px-3">
                {[
                  { id: "Dashboard", label: "Dashboard", icon: LayoutDashboard, color: "bg-blue-800 text-white" },
                  { id: "Kanban", label: "Case Kanban", icon: CheckSquare, color: "bg-blue-800 text-white" },
                  { id: "Calendar", label: "Team Calendar", icon: CalendarIcon, color: "bg-blue-800 text-white" },
                  { id: "ClientCases", label: "Client Cases", icon: Briefcase, color: "bg-blue-800 text-white" },
                  { id: "Attendance", label: "Attendance Logs", icon: Clock, color: "bg-blue-800 text-white" },
                  { id: "Chatbot", label: "AI Bot", icon: Bot, color: "bg-blue-800 text-white" }
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = currentView === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setCurrentView(item.id as any)}
                      aria-label={item.label}
                      title={item.label}
                      className={`w-full rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-3 transition-all border border-transparent cursor-pointer group ${
                        isActive
                          ? "bg-amber-50 text-slate-900 font-extrabold border-amber-100"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 hover:translate-x-0.5"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`rounded-full p-2 ${item.color} flex items-center justify-center shadow-3xs transition-transform group-hover:scale-105`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        {!sidebarCollapsed && <span className="text-sm font-bold tracking-tight">{item.label}</span>}
                      </div>

                      <ChevronRight className={`${sidebarCollapsed ? "hidden" : "block"} h-3.5 w-3.5 transition-transform text-slate-350 ${
                        isActive ? "translate-x-0 text-blue-800" : "opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5"
                      }`} />
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>

        <div className={sidebarCollapsed ? "px-3" : "px-5"}>
          <p title="Made with love by Handysolver © 2026" className={`mb-2 text-center text-[10px] font-medium leading-relaxed text-slate-400 ${sidebarCollapsed ? "text-base" : ""}`}>
            <span aria-hidden="true">🧡</span>
            {!sidebarCollapsed && <span> Made with love by Handysolver © 2026</span>}
          </p>
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="sidebar-collapse" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /><span>Collapse</span></>}
          </button>
        </div>

      </aside>

      {/* 1b. iOS BOTTOM NAVIGATION TAB BAR (Mobile & Tablet bottom fixed) */}
      <nav className="md:hidden fixed bottom-3 left-3 right-3 h-16 bg-slate-900 rounded-full flex items-center justify-around z-40 px-2 shadow-xl">
        {[
          { id: "Dashboard", label: "Dashboard", icon: LayoutDashboard },
          { id: "Kanban", label: "Kanban", icon: CheckSquare },
          { id: "Calendar", label: "Team Calendar", icon: CalendarIcon },
          { id: "ClientCases", label: "Clients", icon: Briefcase },
          { id: "Attendance", label: "Logs", icon: Clock },
          { id: "Chatbot", label: "AI Bot", icon: Bot }
        ].map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id as any)}
              aria-label={item.label}
              className="flex-1 flex items-center justify-center py-1 transition-all active:scale-90 cursor-pointer"
            >
              <span className={`flex items-center justify-center rounded-full transition-all ${
                isActive ? "h-10 w-10 bg-gradient-to-br from-blue-600 to-cyan-500 shadow-lg" : "h-10 w-10"
              }`}>
                <Icon className={`h-5 w-5 ${isActive ? "text-white stroke-[2.5]" : "text-slate-400 stroke-[1.8]"}`} />
              </span>
            </button>
          );
        })}
      </nav>

      {/* 2. MAIN CORE CONTENT VIEWS SCREEN */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto pb-24 md:pb-0">
        
        {/* Top Header Bar */}
        <header className="legal-topbar relative z-30 min-h-[82px] shrink-0 border-b border-slate-200/80 md:border md:border-slate-200/70 md:rounded-2xl flex items-center justify-between px-5 md:px-7 bg-white md:mt-4 md:mr-4 md:mb-2 md:ml-2 md:soft-shadow gap-4">

          <div className="flex flex-col shrink-0">
            <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-slate-400">Workspace / {getViewLabel(currentView)}</span>
            <span className="text-xl font-extrabold text-slate-900 tracking-tight font-display">
              {getViewLabel(currentView)}
            </span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => setDarkMode(!darkMode)} className="topbar-icon hidden sm:grid" aria-label="Toggle dark mode" title="Toggle theme">
              {darkMode ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
            </button>

            {/* iOS Mobile Delegate Button (Header) */}
            <button
              onClick={() => {
                setNewTaskStage("Case Intake");
                if (projectsList.length > 0) setNewTaskProject(projectsList[0].id);
                if (usersList.length > 0) setNewTaskAssignee(usersList[0].id);
                setShowCreateTaskModal(true);
              }}
              className="md:hidden flex h-9 w-9 items-center justify-center rounded-full bg-blue-900 text-white shadow-3xs active:scale-95 transition-transform cursor-pointer"
              title="New Task"
            >
              <Plus className="h-4.5 w-4.5" />
            </button>

            {/* Interactive features: notifications in-app center */}
            <div className="relative">
              <button
                onClick={() => setShowNotificationsDropdown(!showNotificationsDropdown)}
                className="topbar-icon relative p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-650 hover:text-slate-950 hover:bg-slate-100 active:scale-95 transition-all text-sm cursor-pointer"
                aria-label="Open notifications"
                title="Notifications"
                aria-expanded={showNotificationsDropdown}
              >
              <Bell className="h-4.5 w-4.5" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 rounded-full bg-rose-500 text-white text-[9px] font-black h-4 w-4 flex items-center justify-center font-mono border border-white animate-pulse">
                  {unreadNotificationsCount}
                </span>
              )}
            </button>

            {/* In-app notification center modal dropdown lists */}
            {showNotificationsDropdown && (
              <>
                <div
                  className="fixed inset-0 z-[90]"
                  onClick={() => setShowNotificationsDropdown(false)}
                />
                <div role="dialog" aria-label="Notifications" className="notification-panel absolute right-0 top-full mt-3 w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white border border-slate-200 text-slate-800 shadow-2xl p-5 space-y-4 z-[100] animate-dropdown-in">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h4 className="text-sm font-extrabold uppercase tracking-wider text-slate-800 font-display">Alerts</h4>
                  <button
                    onClick={handleMarkAllNotificationsRead}
                    className="text-xs text-blue-900 hover:text-blue-950 font-bold underline cursor-pointer"
                  >
                    Dismiss All
                  </button>
                </div>

                <div className="space-y-2.5 max-h-[240px] overflow-y-auto pr-0.5">
                  {notificationsList.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleMarkNotificationRead(n.id)}
                      className={`p-3 rounded-xl text-xs leading-relaxed border transition-all cursor-pointer ${
                        n.readStatus
                          ? "bg-slate-50 border-slate-100 text-slate-400"
                          : "bg-amber-50/50 border-amber-100 text-slate-800 shadow-xs"
                      } flex gap-2.5 items-start`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${
                        n.type === "error" ? "bg-rose-500 animate-pulse" :
                        n.type === "warning" ? "bg-amber-400" :
                        n.type === "success" ? "bg-emerald-400" : "bg-blue-700"
                      }`} />
                      <div>
                        <p className="font-medium">{n.message}</p>
                        <span className="text-xs text-slate-400 font-mono mt-1 block">
                          {new Date(n.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                      </div>
                    </div>
                  ))}

                  {notificationsList.length === 0 && (
                    <div className="text-center py-8 text-xs text-slate-500 italic">No notification logs detected. All tasks are steady.</div>
                  )}
                </div>

                <div className="text-center text-xs text-slate-400 border-t border-slate-100 pt-3 font-semibold">
                  Click on alerts to dismiss them individually.
                </div>
                </div>
              </>
            )}
            </div>

            <div className="relative">
              <button
                onClick={() => setShowAccountMenu((v) => !v)}
                className="topbar-icon"
                aria-label="Account settings"
                title="Account settings"
              >
                <Settings className="h-4.5 w-4.5" />
              </button>
              {showAccountMenu && (
                <>
                  <div className="fixed inset-0 z-[90]" onClick={() => setShowAccountMenu(false)} />
                  <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-slate-200 rounded-xl shadow-2xl z-[100] overflow-hidden py-1 animate-dropdown-in">
                    <button
                      onClick={() => { setShowAccountMenu(false); openProfile(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <UserIcon className="h-4 w-4 text-slate-500" />
                      Profile Settings
                    </button>
                    <button
                      onClick={() => { setShowAccountMenu(false); handleLogOut(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

        </header>

        {/* Dynamic Screen View routing rendering */}
        <div className="workspace-content flex-1 p-4 sm:p-5 md:pt-3 md:pl-2.5 md:pr-5 md:pb-5 w-full min-w-0">
          <AnimatePresence>
            <motion.div
              key={currentView}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              {currentView === "Dashboard" && (
                <DashboardView
                  tasks={tasksList}
                  users={usersList}
                  currentUser={currentUser}
                  onSelectTask={(t) => setSelectedTask(t)}
                  onPlayTask={handlePlayTimerInline}
                  onPauseTask={handlePauseTimerInline}
                  leaveRequests={leavesList}
                  onUpdateLeaveStatus={handleUpdateLeaveStatus}
                  onCelebrate={triggerCelebration}
                  onSessionExpired={handleLogOut}
                />
              )}

              {currentView === "Kanban" && (
                <KanbanView
                  tasks={tasksList}
                  users={usersList}
                  onSelectTask={(t) => setSelectedTask(t)}
                  onUpdateStage={(id, nextStage) => handleUpdateTask(id, { stage: nextStage })}
                  onCreateTaskQuick={handleOpenQuickCreateKanban}
                  onPlayTask={handlePlayTimerInline}
                  onPauseTask={handlePauseTimerInline}
                />
              )}

              {currentView === "Calendar" && (
                <CalendarView
                  tasks={tasksList}
                  users={usersList}
                  events={eventsList}
                  onSelectTask={(t) => setSelectedTask(t)}
                  onCreateEvent={handleCreateEvent}
                />
              )}

              {currentView === "ClientCases" && (
                <ClientCasesView
                  projects={projectsList}
                  tasks={tasksList}
                  users={usersList}
                  onAddProject={handleCreateProject}
                  onUpdateProject={handleUpdateProject}
                  onUploadDocument={handleUploadCasePaper}
                  onOpenDocument={handleOpenCasePaper}
                />
              )}

              {currentView === "Attendance" && (
                <AttendanceLogsView
                  currentUser={currentUser}
                  users={usersList}
                  onUpdateLeaveStatus={handleUpdateLeaveStatus}
                  onCelebrate={triggerCelebration}
                />
              )}
              {currentView === "Chatbot" && <ChatbotView users={usersList} />}
            </motion.div>
          </AnimatePresence>
        </div>

      </main>

      <AnimatePresence>
        {celebration && (
          <motion.div key={celebration.id} className="celebration-overlay" role="status" aria-live="polite" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="celebration-glow" />
            <div className="celebration-confetti" aria-hidden="true">
              {Array.from({ length: 42 }, (_, index) => (
                <i key={index} style={{ left: `${(index * 37) % 100}%`, animationDelay: `${(index % 12) * 0.045}s`, animationDuration: `${1.8 + (index % 6) * 0.16}s`, backgroundColor: ["#f59e0b", "#2563eb", "#10b981", "#ec4899", "#8b5cf6"][index % 5] }} />
              ))}
            </div>
            <motion.div className="celebration-card" initial={{ y: 28, scale: .86, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: -10, scale: .96, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 20 }}>
              <div className="celebration-check"><Check className="h-9 w-9" /></div>
              <Sparkles className="celebration-spark celebration-spark-left" aria-hidden="true" />
              <Sparkles className="celebration-spark celebration-spark-right" aria-hidden="true" />
              <p>Milestone achieved</p>
              <h2>{celebration.title}</h2>
              <span>{celebration.message}</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProfileModal && (
          <motion.div className="profile-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={(e) => e.target === e.currentTarget && setShowProfileModal(false)}>
            <motion.form onSubmit={handleSaveProfile} className="profile-modal" initial={{opacity:0, y:16, scale:.98}} animate={{opacity:1, y:0, scale:1}} exit={{opacity:0, y:10, scale:.98}}>
              <div className="profile-modal-head">
                <label className="profile-avatar-large profile-avatar-editable" title="Change profile photo">
                  <img src={profileAvatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150"} alt={currentUser.name} />
                  <span className="profile-avatar-edit-badge"><Camera className="h-3.5 w-3.5" /></span>
                  <input type="file" accept="image/*" onChange={handleProfileAvatarSelect} hidden />
                </label>
                <div><span>Account settings</span><h2>Edit profile</h2><p>Update your personal and access details.</p></div>
                <button type="button" onClick={() => setShowProfileModal(false)} aria-label="Close" title="Close"><X className="h-4 w-4" /></button>
              </div>
              <div className="profile-fields">
                <label><span>Username</span><input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Your name" /></label>
                <label><span>Phone number</span><input type="tel" value={profilePhone} onChange={(e) => setProfilePhone(e.target.value)} placeholder="+91 98765 43210" /></label>
                <label><span>Role</span><select value={profileRole} onChange={(e) => setProfileRole(e.target.value as UserRole)} disabled={currentUser.role !== "Admin"} title={currentUser.role !== "Admin" ? "Only an admin can change user roles" : "Change role"}><option value="Team Member">Attorney</option><option value="Manager">Manager</option><option value="Admin">Admin</option></select>{currentUser.role !== "Admin" && <small className="text-[10px] text-slate-400 mt-1 block">Only an admin can change user roles.</small>}</label>
                <label><span>Email</span><input value={currentUser.email} disabled /></label>
              </div>

              <div className="profile-fields" style={{ marginTop: 4 }}>
                <label>
                  <span>Desktop notifications</span>
                  <button
                    type="button"
                    onClick={handleRequestNotificationPermission}
                    disabled={notifPermission === "granted" || notifPermission === "unsupported"}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 text-xs font-bold text-slate-700 disabled:opacity-60 cursor-pointer"
                  >
                    {notifPermission === "granted" ? "Enabled" : notifPermission === "denied" ? "Blocked in browser settings" : notifPermission === "unsupported" ? "Not supported on this device" : "Enable popup reminders"}
                  </button>
                  <small className="text-[10px] text-slate-400 mt-1 block">Lets event reminders pop up as a browser notification, not just the in-app bell.</small>
                </label>
                {currentUser.role === "Admin" && (
                  <label>
                    <span>Event reminder lead time</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={reminderMinutesInput}
                        onChange={(e) => setReminderMinutesInput(e.target.value)}
                        className="flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveSettings({ eventReminderMinutesBefore: Math.max(1, Number(reminderMinutesInput) || 10) })}
                        className="shrink-0 rounded-xl bg-blue-900 text-white px-3 py-2 text-xs font-bold cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                    <small className="text-[10px] text-slate-400 mt-1 block">Minutes before a calendar event that assignees get reminded (applies to every event).</small>
                  </label>
                )}
              </div>

              {profileError && <p className="profile-error">{profileError}</p>}
              <div className="profile-actions"><button type="button" onClick={() => setShowProfileModal(false)}>Cancel</button><button type="submit" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save changes"}</button></div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. MULTI-ROLE DETAILED TASK WORKSPACE MODAL */}
      <AnimatePresence>
        {selectedTask && (
          <TaskModal
            task={selectedTask}
            currentUser={currentUser}
            users={usersList}
            onClose={() => setSelectedTask(null)}
            onUpdate={(fields) => {
              // Timer endpoints already return the fully persisted task. Apply it
              // directly instead of sending a second PUT that can restore stale state.
              if ("id" in fields && fields.id === selectedTask.id) {
                const freshTask = fields as Task;
                const wasComplete = selectedTask.status === "Completed" || selectedTask.stage === "Completed";
                const isComplete = freshTask.status === "Completed" || freshTask.stage === "Completed";
                setTasksList((current) => current.map((task) => task.id === freshTask.id ? freshTask : task));
                setSelectedTask(freshTask);
                if (!wasComplete && isComplete) {
                  triggerCelebration("Task completed!", `${freshTask.title} is now in the Completed column.`);
                }
                return;
              }
              void handleUpdateTask(selectedTask.id, fields);
            }}
          />
        )}
      </AnimatePresence>

      {/* 4. MODAL: CREATE TASK POPUP DIALOG */}
      <AnimatePresence>
        {showCreateTaskModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4">
            {/* Backdrop blur & fade-in */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowCreateTaskModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            
            {/* Modal Box scale & springy entry */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", duration: 0.45, bounce: 0.12 }}
              className="relative w-[560px] max-w-full rounded-2xl sm:rounded-[32px] bg-white border border-slate-200 text-slate-850 p-5 sm:p-7 md:p-9 shadow-2xl space-y-5 sm:space-y-7 max-h-[94vh] sm:max-h-[90vh] overflow-y-auto z-10 animate-modal-in"
            >

              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900 font-display flex items-center gap-2">
                    New Task
                  </h3>
                  <p className="text-sm text-slate-500 font-medium mt-1.5">Assign work to a team member.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateTaskModal(false)}
                  aria-label="Close"
                  title="Close"
                  className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-all cursor-pointer shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleCreateTask} className="space-y-5">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase font-bold tracking-wider text-slate-400 font-display block mb-1.5">
                      Client / Assignment
                    </label>
                    <select
                      value={newTaskProject}
                      onChange={(e) => setNewTaskProject(e.target.value)}
                      className="w-full rounded-2xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 focus:border-slate-400 outline-hidden cursor-pointer font-medium transition-colors hover:border-slate-300"
                    >
                      {projectsList.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.clientName || "General Client"} — {project.name.replace(/^Matter\b/, "Case")}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase font-bold tracking-wider text-slate-400 font-display block mb-1.5">
                    Title
                  </label>
                  <input
                    type="text"
                    required
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="What needs to be done?"
                    className="w-full rounded-2xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-slate-400 outline-hidden font-medium transition-colors hover:border-slate-300"
                  />
                </div>

                <div>
                  <label className="text-xs uppercase font-bold tracking-wider text-slate-400 font-display block mb-1.5">
                    Description
                  </label>
                  <textarea
                    value={newTaskDesc}
                    onChange={(e) => setNewTaskDesc(e.target.value)}
                    placeholder="Add details, key dates, or notes..."
                    rows={3}
                    className="w-full rounded-2xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-slate-400 outline-hidden resize-none font-medium transition-colors hover:border-slate-300"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs uppercase font-bold tracking-wider text-slate-400 font-display block mb-1.5">
                      Due Date
                    </label>
                    <input
                      type="date"
                      required
                      value={newTaskDueDate}
                      onChange={(e) => setNewTaskDueDate(e.target.value)}
                      className="w-full rounded-2xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-slate-400 outline-hidden font-mono transition-colors hover:border-slate-300"
                    />
                  </div>

                  <div>
                    <label className="text-xs uppercase font-bold tracking-wider text-slate-400 font-display block mb-1.5">
                      Assignee
                    </label>
                    <select
                      value={newTaskAssignee}
                      onChange={(e) => setNewTaskAssignee(e.target.value)}
                      className="w-full rounded-2xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-slate-400 outline-hidden cursor-pointer font-medium transition-colors hover:border-slate-300"
                    >
                      {usersList.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs uppercase font-bold tracking-wider text-slate-400 font-display block mb-1.5">
                      Priority
                    </label>
                    <select
                      value={newTaskPriority}
                      onChange={(e) => setNewTaskPriority(e.target.value as any)}
                      className="w-full rounded-2xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-slate-400 outline-hidden cursor-pointer font-medium transition-colors hover:border-slate-300"
                    >
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                      <option value="Critical">Critical</option>
                    </select>
                  </div>
                </div>

                {createTaskError && (
                  <p className="text-xs text-rose-600 font-black text-center">{createTaskError}</p>
                )}

                <button
                  type="submit"
                  className="w-full bg-gradient-to-r from-blue-700 to-cyan-600 hover:from-blue-800 hover:to-cyan-700 hover:shadow-lg active:scale-98 font-bold text-xs py-3.5 rounded-full text-white transition-all cursor-pointer shadow-sm tracking-wide uppercase font-display"
                >
                  Create Task
                </button>
              </form>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
