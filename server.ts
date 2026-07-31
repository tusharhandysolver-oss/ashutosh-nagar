/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();
const PORT = 3000;

// Initialize Supabase data access via its REST API (service_role key bypasses RLS).
// This avoids needing a direct Postgres connection string/password.
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
let supabaseAdmin: SupabaseClient | null = null;

if (process.env.SUPABASE_URL && supabaseServiceRoleKey) {
  supabaseAdmin = createClient(process.env.SUPABASE_URL, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  console.log("Supabase data client (service_role) initialized.");
} else {
  console.log("No SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY found. Running in local JSON storage mode.");
}

// Initialize Supabase Auth client (email + password authentication)
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
let supabaseAuth: SupabaseClient | null = null;

if (supabaseUrl && supabaseAnonKey) {
  supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  console.log("Supabase Auth client initialized.");
} else {
  console.log("No SUPABASE_URL/SUPABASE_ANON_KEY found. Auth will fall back to local mock login.");
}

app.use(express.json({ limit: "5mb" }));

// Body-parser errors (e.g. payload too large, malformed JSON) must be caught here,
// right after express.json(), otherwise Express falls back to its default HTML
// error page - which breaks every frontend `res.json()` call expecting JSON back.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "That file is too large. Please choose a smaller image." });
  }
  if (err) {
    return res.status(400).json({ error: "Invalid request body." });
  }
  next();
});

// Lazily runs the Supabase seed/load sequence exactly once per process.
// Traditional hosts (Render/local) trigger this from startServer() before
// listening; serverless hosts (Vercel) have no such boot hook, so this
// middleware guarantees it still runs before the first request is handled.
let initPromise: Promise<void> | null = null;
function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      if (supabaseAdmin) {
        try {
          await initializeSupabaseDatabase();
          await loadMemoryDbFromSupabase();
        } catch (err) {
          console.error("Critical error during Supabase initialization sequence:", err);
        }
      }
    })();
  }
  return initPromise;
}

// Throttles the per-request Vercel reload below: cross-instance staleness of a
// couple seconds is an acceptable tradeoff for not paying a 9-table Supabase
// round-trip on every single request in a burst (e.g. a page load firing off
// tasks/users/projects/notifications/goals/attendance concurrently).
let lastSupabaseLoadAt = 0;
const SUPABASE_RELOAD_THROTTLE_MS = 2000;

app.use((req, res, next) => {
  ensureInitialized()
    .then(() => {
      // On Vercel, different requests can land on different serverless
      // instances, each holding its own copy of memoryDb loaded once at cold
      // start. Without this, a user/task/etc. created by a request handled
      // on instance A never shows up for requests handled by instance B
      // until B happens to cold-start again. Refreshing from Supabase on
      // every request keeps reads consistent across instances; traditional
      // hosts (Render/local, one persistent process) skip this since their
      // single memoryDb is already kept current by every write.
      if (process.env.VERCEL && supabaseAdmin && Date.now() - lastSupabaseLoadAt > SUPABASE_RELOAD_THROTTLE_MS) {
        lastSupabaseLoadAt = Date.now();
        return loadMemoryDbFromSupabase().catch((err) => {
          console.error("Failed to refresh memoryDb from Supabase:", err);
        });
      }
    })
    .then(() => next())
    .catch(next);
});

// Initialize Gemini SDK with telemetry compliance User-Agent
const geminiApiKey = process.env.GEMINI_API_KEY || "";
let ai: GoogleGenAI | null = null;
if (geminiApiKey && geminiApiKey !== "MY_GEMINI_API_KEY") {
  try {
    ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  } catch (error) {
    console.error("Failed to initialize Gemini AI SDK:", error);
  }
} else {
  console.warn("GEMINI_API_KEY is not set or placeholder. AI features will fallback gracefully.");
}

// Data persistence path
const DATA_FILE = path.join(process.cwd(), "data.json");

// Define basic database structures
interface AppData {
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: "Admin" | "Manager" | "Team Member";
    department: string;
    avatar?: string;
    phone?: string;
    createdAt: string;
  }>;
  projects: Array<{
    id: string;
    name: string;
    description: string;
    createdAt: string;
    clientName?: string;
    matterCode?: string;
    practiceArea?: string;
    status?: "Active" | "On Hold" | "Closed";
    budget?: number;
    clientEmail?: string;
    clientPhone?: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    priority: "Critical" | "High" | "Medium" | "Low";
    status: "Not Started" | "In Progress" | "Under Review" | "Blocked" | "Completed";
    stage: "Case Intake" | "In Progress" | "Completed";
    dueDate: string;
    createdAt: string;
    lastUpdatedDate: string;
    assignedBy: string;
    assignedTo: string;
    projectId: string;
    projectName: string;
    tags: string[];
    estimatedHours: number;
    actualHours: number;
    attachments: string[];
    isBillable?: boolean;
    hourlyRate?: number;
    clientApprovalStatus?: "Approved" | "Pending Review" | "Not Required";
    matterCode?: string;
    startedAt?: string | null;
    completedAt?: string | null;
    actualDaysElapsed?: number | null;
    actualHoursElapsed?: number | null;
    timerState?: "idle" | "running" | "paused";
    lastStartedAt?: string | null;
    totalActiveMs?: number;
    remindedTriggerKeys?: string[];
  }>;
  comments: Array<{
    id: string;
    taskId: string;
    userId: string;
    userName: string;
    userAvatar?: string;
    comment: string;
    createdAt: string;
  }>;
  notifications: Array<{
    id: string;
    userId: string;
    message: string;
    type: "info" | "success" | "warning" | "error";
    readStatus: boolean;
    createdAt: string;
  }>;
  activityLogs: Array<{
    id: string;
    taskId: string;
    userId: string;
    userName: string;
    action: string;
    timestamp: string;
  }>;
  settings: {
    reminderInDays: number;
    enableEmailNotifications: boolean;
    enableUrgentAlerts: boolean;
    autoRiskAnalysis: boolean;
    eventReminderMinutesBefore?: number;
  };
  goals: Array<{
    id: string;
    title: string;
    description: string;
    assignedTo: string; // Person working on the goal
    accountable: string; // Accountable person
    assignedBy: string; // Goal creator / assigner
    targetDate: string;
    progress: number; // 0 to 100
    status: "Not Started" | "In Progress" | "Completed" | "At Risk";
    accountableNotes?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  attendances?: Array<{
    id: string;
    userId: string;
    userName: string;
    date: string; // YYYY-MM-DD
    type: "WFH";
    status: "Open" | "Closed";
    clockInTime: string;
    clockOutTime?: string;
  }>;
  leaveRequests?: Array<{
    id: string;
    userId: string;
    userName: string;
    startDate: string;
    endDate: string;
    reason: string;
    status: "Pending" | "Approved" | "Rejected";
    createdAt: string;
  }>;
  calendarEvents?: Array<{
    id: string;
    title: string;
    description: string;
    dueDate: string; // YYYY-MM-DD
    time: string; // HH:MM, 24h
    assigneeIds: string[];
    createdBy: string;
    createdAt: string;
    remindedUserIds?: string[];
  }>;
}

// Preseeded Initial Data
const initialData: AppData = {
  users: [
    {
      id: "usr-3",
      name: "Tushar bali",
      email: "tushar.handysolver@gmail.com",
      role: "Team Member",
      department: "Associate Attorney",
      avatar: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150",
      createdAt: "2026-02-01T10:00:00Z"
    },
    {
      id: "usr-101",
      name: "Priya Desai, Esq.",
      email: "priya.desai@company.com",
      role: "Admin",
      department: "Senior Litigation Partner",
      avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150",
      createdAt: "2026-01-08T08:00:00Z"
    },
    {
      id: "usr-102",
      name: "Arjun Mehta, Esq.",
      email: "arjun.mehta@company.com",
      role: "Manager",
      department: "Managing Partner",
      avatar: "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150",
      createdAt: "2026-01-10T09:30:00Z"
    },
    {
      id: "usr-103",
      name: "Ritika Sharma",
      email: "ritika.sharma@company.com",
      role: "Team Member",
      department: "Senior Litigation Paralegal",
      avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150",
      createdAt: "2026-01-14T11:00:00Z"
    },
    {
      id: "usr-104",
      name: "Karan Malhotra",
      email: "karan.malhotra@company.com",
      role: "Team Member",
      department: "Legal Assistant",
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150",
      createdAt: "2026-01-18T14:15:00Z"
    }
  ],
  projects: [
    {
      id: "prj-101",
      name: "Matter #26-210: Horizon Textiles Trademark Dispute",
      description: "Trademark infringement suit against a competing apparel brand; drafting cease-and-desist responses, evidentiary exhibits, and licensing settlement terms.",
      createdAt: "2026-05-02T08:00:00Z"
    },
    {
      id: "prj-102",
      name: "Matter #26-330: Meridian Bank Data Breach Litigation",
      description: "Multi-plaintiff data breach defense; coordinating discovery on incident response logs, drafting motions to consolidate, and negotiating regulator disclosures.",
      createdAt: "2026-05-18T09:00:00Z"
    },
    {
      id: "prj-103",
      name: "Matter #26-455: Coastal Realty Zoning Appeal",
      description: "Municipal zoning board appeal for a mixed-use development permit; preparing site impact reports and administrative hearing briefs.",
      createdAt: "2026-06-02T10:00:00Z"
    },
    {
      id: "prj-104",
      name: "Matter #26-560: Orion Logistics Labor Arbitration",
      description: "Wage-and-hour arbitration for a regional freight carrier; compiling payroll records, drafting arbitration statements, and scheduling witness prep.",
      createdAt: "2026-06-14T09:00:00Z"
    },
    {
      id: "prj-105",
      name: "Matter #26-670: Zenith Pharma Product Liability Defense",
      description: "Product liability defense for a generic drug manufacturer; managing expert witness reports and coordinating multi-jurisdiction case strategy.",
      createdAt: "2026-06-20T14:00:00Z"
    }
  ],
  tasks: [
    {
      id: "TSK-2001",
      title: "Draft Trademark Settlement & Licensing Term Sheet",
      description: "Prepare mutual settlement terms and forward licensing arrangement to resolve the Horizon Textiles mark dispute ahead of the scheduled hearing.",
      priority: "High",
      status: "In Progress",
      stage: "In Progress",
      dueDate: "2026-07-25T18:00:00Z",
      createdAt: "2026-07-10T09:00:00Z",
      lastUpdatedDate: "2026-07-14T11:00:00Z",
      assignedBy: "usr-102",
      assignedTo: "usr-3",
      projectId: "prj-101",
      projectName: "Matter #26-210: Horizon Textiles Trademark Dispute",
      tags: ["Trademark", "Settlement", "Licensing"],
      estimatedHours: 14,
      actualHours: 6,
      attachments: ["settlement_draft_v1.docx"]
    },
    {
      id: "TSK-2002",
      title: "Coordinate Data Breach Discovery Production",
      description: "Compile and index incident-response logs and customer notification records for the consolidated data breach discovery request.",
      priority: "Critical",
      status: "In Progress",
      stage: "In Progress",
      dueDate: "2026-07-24T17:00:00Z",
      createdAt: "2026-07-08T09:30:00Z",
      lastUpdatedDate: "2026-07-13T15:00:00Z",
      assignedBy: "usr-101",
      assignedTo: "usr-103",
      projectId: "prj-102",
      projectName: "Matter #26-330: Meridian Bank Data Breach Litigation",
      tags: ["Discovery", "Data-Breach", "Consolidation"],
      estimatedHours: 20,
      actualHours: 9,
      attachments: ["incident_log_index.xlsx"]
    },
    {
      id: "TSK-2003",
      title: "Prepare Zoning Board Hearing Brief",
      description: "Draft administrative hearing brief and site impact summary for the mixed-use development permit appeal.",
      priority: "Medium",
      status: "Not Started",
      stage: "Case Intake",
      dueDate: "2026-07-30T17:00:00Z",
      createdAt: "2026-07-11T10:00:00Z",
      lastUpdatedDate: "2026-07-11T10:00:00Z",
      assignedBy: "usr-102",
      assignedTo: "usr-104",
      projectId: "prj-103",
      projectName: "Matter #26-455: Coastal Realty Zoning Appeal",
      tags: ["Zoning", "Hearing-Brief", "Permits"],
      estimatedHours: 10,
      actualHours: 0,
      attachments: []
    },
    {
      id: "TSK-2004",
      title: "Compile Payroll Records for Wage Arbitration",
      description: "Gather and reconcile driver payroll and overtime records for the Orion Logistics wage-and-hour arbitration statement.",
      priority: "High",
      status: "Blocked",
      stage: "In Progress",
      dueDate: "2026-07-21T12:00:00Z",
      createdAt: "2026-07-05T11:00:00Z",
      lastUpdatedDate: "2026-07-12T11:00:00Z",
      assignedBy: "usr-101",
      assignedTo: "usr-3",
      projectId: "prj-104",
      projectName: "Matter #26-560: Orion Logistics Labor Arbitration",
      tags: ["Arbitration", "Payroll", "Wage-Hour"],
      estimatedHours: 16,
      actualHours: 4,
      attachments: ["payroll_reconciliation.xlsx"]
    },
    {
      id: "TSK-2005",
      title: "Review Expert Witness Report on Drug Formulation",
      description: "Review the toxicology expert's report on the generic formulation and flag inconsistencies for cross-examination prep.",
      priority: "Critical",
      status: "Completed",
      stage: "Completed",
      dueDate: "2026-07-14T18:00:00Z",
      createdAt: "2026-06-28T09:00:00Z",
      lastUpdatedDate: "2026-07-14T16:30:00Z",
      assignedBy: "usr-102",
      assignedTo: "usr-103",
      projectId: "prj-105",
      projectName: "Matter #26-670: Zenith Pharma Product Liability Defense",
      tags: ["Expert-Witness", "Product-Liability", "Review"],
      estimatedHours: 12,
      actualHours: 11,
      attachments: ["expert_report_annotated.pdf"]
    },
    {
      id: "TSK-2009",
      title: "Prepare Deposition Outline for Zenith Pharma Case Manager",
      description: "Draft the deposition question outline and exhibit list for the Zenith Pharma product liability case manager interview.",
      priority: "High",
      status: "In Progress",
      stage: "In Progress",
      dueDate: "2026-07-23T17:00:00Z",
      createdAt: "2026-07-13T09:00:00Z",
      lastUpdatedDate: "2026-07-15T10:00:00Z",
      assignedBy: "usr-102",
      assignedTo: "usr-3",
      projectId: "prj-105",
      projectName: "Matter #26-670: Zenith Pharma Product Liability Defense",
      tags: ["Deposition", "Product-Liability", "Outline"],
      estimatedHours: 9,
      actualHours: 3,
      attachments: []
    },
    {
      id: "TSK-2010",
      title: "File Motion for Extension in Coastal Realty Appeal",
      description: "Prepare and file a motion requesting a 14-day extension on the zoning board hearing brief deadline.",
      priority: "Medium",
      status: "Not Started",
      stage: "Case Intake",
      dueDate: "2026-07-27T17:00:00Z",
      createdAt: "2026-07-15T09:00:00Z",
      lastUpdatedDate: "2026-07-15T09:00:00Z",
      assignedBy: "usr-102",
      assignedTo: "usr-3",
      projectId: "prj-103",
      projectName: "Matter #26-455: Coastal Realty Zoning Appeal",
      tags: ["Motion", "Zoning", "Filing"],
      estimatedHours: 3,
      actualHours: 0,
      attachments: []
    }
  ],
  comments: [
    {
      id: "com-101",
      taskId: "TSK-2001",
      userId: "usr-102",
      userName: "Arjun Mehta, Esq.",
      userAvatar: "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150",
      comment: "Make sure the licensing terms cap royalty rates in line with the client's ceiling from last week's call.",
      createdAt: "2026-07-12T10:15:00Z"
    },
    {
      id: "com-102",
      taskId: "TSK-2001",
      userId: "usr-3",
      userName: "Tushar bali",
      comment: "Understood — draft now reflects the 4% cap and a 3-year renewal window.",
      createdAt: "2026-07-13T14:20:00Z"
    },
    {
      id: "com-103",
      taskId: "TSK-2004",
      userId: "usr-3",
      userName: "Tushar bali",
      comment: "Blocked on this — waiting for the client's HR system export before I can reconcile the overtime figures.",
      createdAt: "2026-07-12T15:28:00Z"
    },
    {
      id: "com-104",
      taskId: "TSK-2009",
      userId: "usr-3",
      userName: "Tushar bali",
      comment: "First pass at the deposition outline is done — sharing with Arjun for review before finalizing exhibit numbering.",
      createdAt: "2026-07-15T10:00:00Z"
    }
  ],
  notifications: [
    {
      id: "not-seed-1",
      userId: "usr-3",
      message: "🔔 TASK ASSIGNED: You were assigned \"Draft Trademark Settlement & Licensing Term Sheet\" (TSK-2001) by Arjun Mehta, Esq.",
      type: "info",
      readStatus: false,
      createdAt: "2026-07-10T09:05:00.000Z"
    },
    {
      id: "not-seed-2",
      userId: "usr-3",
      message: "📅 Reminder: Task \"Compile Payroll Records for Wage Arbitration\" (TSK-2004) is due in 4 days.",
      type: "warning",
      readStatus: false,
      createdAt: "2026-07-17T08:00:00.000Z"
    },
    {
      id: "not-seed-3",
      userId: "usr-101",
      message: "✅ TASK COMPLETED: Ritika Sharma completed \"Review Expert Witness Report on Drug Formulation\" (TSK-2005).",
      type: "success",
      readStatus: true,
      createdAt: "2026-07-14T16:30:00.000Z"
    },
    {
      id: "not-seed-4",
      userId: "usr-3",
      message: "🔔 TASK ASSIGNED: You were assigned \"Prepare Deposition Outline for Zenith Pharma Case Manager\" (TSK-2009) by Arjun Mehta, Esq.",
      type: "info",
      readStatus: false,
      createdAt: "2026-07-13T09:05:00.000Z"
    },
    {
      id: "not-seed-5",
      userId: "usr-3",
      message: "🔔 TASK ASSIGNED: You were assigned \"File Motion for Extension in Coastal Realty Appeal\" (TSK-2010) by Arjun Mehta, Esq.",
      type: "info",
      readStatus: false,
      createdAt: "2026-07-15T09:05:00.000Z"
    }
  ],
  activityLogs: [
    {
      id: "log-seed-1",
      taskId: "TSK-2001",
      userId: "usr-102",
      userName: "Arjun Mehta, Esq.",
      action: "Assigned TSK-2001: Draft Trademark Settlement & Licensing Term Sheet to Tushar bali",
      timestamp: "2026-07-10T09:00:00Z"
    },
    {
      id: "log-seed-2",
      taskId: "TSK-2001",
      userId: "usr-3",
      userName: "Tushar bali",
      action: "Started drafting the licensing term sheet",
      timestamp: "2026-07-12T10:00:00Z"
    },
    {
      id: "log-seed-3",
      taskId: "TSK-2005",
      userId: "usr-103",
      userName: "Ritika Sharma",
      action: "Completed task. Working-time: 11 hours, 1.32 days.",
      timestamp: "2026-07-14T16:30:00Z"
    },
    {
      id: "log-seed-4",
      taskId: "TSK-2009",
      userId: "usr-3",
      userName: "Tushar bali",
      action: "Started drafting the deposition outline",
      timestamp: "2026-07-14T09:00:00Z"
    }
  ],
  settings: {
    reminderInDays: 3,
    enableEmailNotifications: true,
    enableUrgentAlerts: true,
    autoRiskAnalysis: true,
    eventReminderMinutesBefore: 10
  },
  calendarEvents: [],
  goals: [
    {
      id: "G-2001",
      title: "Data Breach Regulatory Response Readiness",
      description: "Ensure all state disclosure notices and compliance documentation are filed ahead of statutory deadlines for the Meridian Bank matter.",
      assignedTo: "usr-101",
      accountable: "usr-102",
      assignedBy: "usr-102",
      targetDate: "2026-08-05T00:00:00.000Z",
      progress: 40,
      status: "In Progress",
      accountableNotes: "Regulator notice draft is in review; on track for the state filing window.",
      createdAt: "2026-07-06T10:00:00.000Z",
      updatedAt: "2026-07-13T16:00:00.000Z"
    },
    {
      id: "G-2002",
      title: "Trademark Matter Early Resolution",
      description: "Reach a signed licensing settlement with Horizon Textiles' counterpart before the scheduled hearing date.",
      assignedTo: "usr-3",
      accountable: "usr-102",
      assignedBy: "usr-102",
      targetDate: "2026-07-28T00:00:00.000Z",
      progress: 55,
      status: "In Progress",
      accountableNotes: "Settlement term sheet drafted; awaiting counterpart's counter-offer on royalty rate.",
      createdAt: "2026-07-10T09:00:00.000Z",
      updatedAt: "2026-07-13T14:20:00.000Z"
    }
  ],
  attendances: [
    {
      id: "att-seed-1",
      userId: "usr-3",
      userName: "Tushar bali",
      date: "2026-07-17",
      type: "WFH",
      status: "Open",
      clockInTime: "2026-07-17T04:00:00.000Z"
    },
    {
      id: "att-seed-2",
      userId: "usr-101",
      userName: "Priya Desai, Esq.",
      date: "2026-07-17",
      type: "WFH",
      status: "Closed",
      clockInTime: "2026-07-17T03:30:00.000Z",
      clockOutTime: "2026-07-17T11:30:00.000Z"
    }
  ],
  leaveRequests: [
    {
      id: "lv-seed-1",
      userId: "usr-104",
      userName: "Karan Malhotra",
      startDate: "2026-07-21",
      endDate: "2026-07-22",
      reason: "Personal work",
      status: "Pending",
      createdAt: "2026-07-16T09:00:00.000Z"
    }
  ]
};

// Helper function to map old stages to new stages
function mapStage(stage: any): "Case Intake" | "In Progress" | "Completed" {
  if (stage === "Case Intake" || stage === "In Progress" || stage === "Completed") {
    return stage;
  }
  if (stage === "Backlog" || stage === "Planning") {
    return "Case Intake";
  }
  if (stage === "Done" || stage === "Completed" || stage === "Deployment" || stage === "Review") {
    return "Completed";
  }
  return "In Progress"; // default for Development, Testing, etc.
}

// Cache memory database representing current live application state
let memoryDb: AppData | null = null;

// Supabase's live tables use snake_case (created independently of this app);
// the app's in-memory AppData shape uses camelCase. These mappers translate both ways.
const rowMappers = {
  users: {
    toRow: (u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, avatar: u.avatar || null, created_at: u.createdAt }),
    fromRow: (r: any) => ({ id: r.id, name: r.name, email: r.email, role: r.role, department: r.department, avatar: r.avatar, createdAt: r.created_at })
  },
  projects: {
    toRow: (p: any) => ({
      id: p.id, name: p.name, description: p.description, created_at: p.createdAt,
      client_name: p.clientName || null, matter_code: p.matterCode || null, practice_area: p.practiceArea || null,
      status: p.status || "Active", budget: p.budget || null, client_email: p.clientEmail || null, client_phone: p.clientPhone || null
    }),
    fromRow: (r: any) => ({
      id: r.id, name: r.name, description: r.description, createdAt: r.created_at,
      clientName: r.client_name, matterCode: r.matter_code, practiceArea: r.practice_area,
      status: r.status, budget: r.budget, clientEmail: r.client_email, clientPhone: r.client_phone
    })
  },
  tasks: {
    toRow: (t: any) => ({
      // The live table's legacy stage constraint does not include "Completed".
      // Completion is canonical in `status`; normalize it back to Completed on read.
      id: t.id, title: t.title, description: t.description, priority: t.priority, status: t.status,
      stage: t.status === "Completed" ? "In Progress" : t.stage,
      due_date: t.dueDate, created_at: t.createdAt, last_updated_date: t.lastUpdatedDate,
      assigned_by: t.assignedBy, assigned_to: t.assignedTo, project_id: t.projectId, project_name: t.projectName,
      tags: t.tags || [], estimated_hours: t.estimatedHours || 0, actual_hours: t.actualHours || 0, attachments: t.attachments || [],
      is_billable: t.isBillable !== undefined ? t.isBillable : true, hourly_rate: t.hourlyRate || 0,
      client_approval_status: t.clientApprovalStatus || "Not Required", matter_code: t.matterCode || null,
      started_at: t.startedAt || null, completed_at: t.completedAt || null, actual_days_elapsed: t.actualDaysElapsed ?? null,
      actual_hours_elapsed: t.actualHoursElapsed ?? null, timer_state: t.timerState || "idle",
      last_started_at: t.lastStartedAt || null, total_active_ms: t.totalActiveMs || 0,
      reminded_trigger_keys: t.remindedTriggerKeys || []
    }),
    fromRow: (r: any) => ({
      id: r.id, title: r.title, description: r.description, priority: r.priority, status: r.status,
      stage: r.status === "Completed" ? "Completed" : r.stage,
      dueDate: r.due_date, createdAt: r.created_at, lastUpdatedDate: r.last_updated_date,
      assignedBy: r.assigned_by, assignedTo: r.assigned_to, projectId: r.project_id, projectName: r.project_name,
      tags: Array.isArray(r.tags) ? r.tags : [], estimatedHours: r.estimated_hours, actualHours: r.actual_hours,
      attachments: Array.isArray(r.attachments) ? r.attachments : [], isBillable: r.is_billable !== null ? r.is_billable : true,
      hourlyRate: r.hourly_rate, clientApprovalStatus: r.client_approval_status, matterCode: r.matter_code,
      startedAt: r.started_at, completedAt: r.completed_at, actualDaysElapsed: r.actual_days_elapsed,
      actualHoursElapsed: r.actual_hours_elapsed, timerState: r.timer_state, lastStartedAt: r.last_started_at,
      totalActiveMs: r.total_active_ms !== null ? parseInt(r.total_active_ms, 10) : 0,
      remindedTriggerKeys: Array.isArray(r.reminded_trigger_keys) ? r.reminded_trigger_keys : []
    })
  },
  comments: {
    toRow: (c: any) => ({ id: c.id, task_id: c.taskId, user_id: c.userId, user_name: c.userName, user_avatar: c.userAvatar || null, comment: c.comment, created_at: c.createdAt }),
    fromRow: (r: any) => ({ id: r.id, taskId: r.task_id, userId: r.user_id, userName: r.user_name, userAvatar: r.user_avatar, comment: r.comment, createdAt: r.created_at })
  },
  notifications: {
    toRow: (n: any) => ({ id: n.id, user_id: n.userId, message: n.message, type: n.type, read_status: n.readStatus, created_at: n.createdAt }),
    fromRow: (r: any) => ({ id: r.id, userId: r.user_id, message: r.message, type: r.type, readStatus: r.read_status, createdAt: r.created_at })
  },
  activity_logs: {
    toRow: (l: any) => ({ id: l.id, task_id: l.taskId, user_id: l.userId, user_name: l.userName, action: l.action, timestamp: l.timestamp }),
    fromRow: (r: any) => ({ id: r.id, taskId: r.task_id, userId: r.user_id, userName: r.user_name, action: r.action, timestamp: r.timestamp })
  },
  goals: {
    toRow: (g: any) => ({
      id: g.id, title: g.title, description: g.description, assigned_to: g.assignedTo, accountable: g.accountable,
      assigned_by: g.assignedBy, target_date: g.targetDate, progress: g.progress, status: g.status,
      accountable_notes: g.accountableNotes || null, created_at: g.createdAt, updated_at: g.updatedAt
    }),
    fromRow: (r: any) => ({
      id: r.id, title: r.title, description: r.description, assignedTo: r.assigned_to, accountable: r.accountable,
      assignedBy: r.assigned_by, targetDate: r.target_date, progress: r.progress, status: r.status,
      accountableNotes: r.accountable_notes, createdAt: r.created_at, updatedAt: r.updated_at
    })
  },
  attendances: {
    toRow: (a: any) => ({ id: a.id, user_id: a.userId, user_name: a.userName, date: a.date, type: a.type, status: a.status, clock_in_time: a.clockInTime, clock_out_time: a.clockOutTime || null }),
    fromRow: (r: any) => ({ id: r.id, userId: r.user_id, userName: r.user_name, date: r.date, type: r.type, status: r.status, clockInTime: r.clock_in_time, clockOutTime: r.clock_out_time })
  },
  leave_requests: {
    toRow: (lv: any) => ({ id: lv.id, user_id: lv.userId, user_name: lv.userName, start_date: lv.startDate, end_date: lv.endDate, reason: lv.reason, status: lv.status, created_at: lv.createdAt }),
    fromRow: (r: any) => ({ id: r.id, userId: r.user_id, userName: r.user_name, startDate: r.start_date, endDate: r.end_date, reason: r.reason, status: r.status, createdAt: r.created_at })
  },
  calendar_events: {
    toRow: (e: any) => ({ id: e.id, title: e.title, description: e.description || "", due_date: e.dueDate, time: e.time, assignee_ids: e.assigneeIds || [], created_by: e.createdBy || null, created_at: e.createdAt, reminded_user_ids: e.remindedUserIds || [] }),
    fromRow: (r: any) => ({ id: r.id, title: r.title, description: r.description, dueDate: r.due_date, time: r.time, assigneeIds: Array.isArray(r.assignee_ids) ? r.assignee_ids : [], createdBy: r.created_by, createdAt: r.created_at, remindedUserIds: Array.isArray(r.reminded_user_ids) ? r.reminded_user_ids : [] })
  }
};

// Task completion is notable enough that Admins should hear about it
// regardless of who assigned the task - not just whoever happened to be the
// assigner. Skips a user who's already getting the assigner notification so
// an Admin who assigned their own task doesn't get pinged twice.
function notifyAdminsOfTaskCompletion(db: AppData, task: AppData["tasks"][number], actorName: string, alreadyNotifiedUserId?: string) {
  const admins = db.users.filter((u) => u.role === "Admin" && u.id !== alreadyNotifiedUserId);
  const hoursNote = task.actualHoursElapsed != null ? ` Tracked time: ${task.actualHoursElapsed} hrs.` : "";
  admins.forEach((admin) => {
    db.notifications.unshift({
      id: `not-${Date.now()}-${Math.floor(Math.random() * 1000)}-admin-comp`,
      userId: admin.id,
      message: `✅ TASK COMPLETED: ${actorName} completed "${task.title}" (${task.id}).${hoursNote}`,
      type: "success",
      readStatus: false,
      createdAt: new Date().toISOString()
    });
  });
}

async function persistTaskRow(task: AppData["tasks"][number]) {
  if (!supabaseAdmin) return;
  const { error } = await upsertResilient("tasks", [rowMappers.tasks.toRow(task)], "id");
  if (error) throw error;
}

// Signup/OAuth-profile create the user's account row this way rather than
// through the fire-and-forget writeDatabase() -> syncMemoryDbToSupabase()
// path: that path only console.error's a failed upsert, so a brand new user
// could get a 201/success response and a session even though their row never
// actually landed in Supabase. The next request from a cold instance (or the
// same instance's throttled reload) would then see them as a nonexistent
// user and reject everything they try to do. Persisting - and checking the
// result - before responding means a failed write surfaces immediately as a
// registration error instead of a confusing "logged in but can't do anything".
async function persistUserRow(user: AppData["users"][number]) {
  if (!supabaseAdmin) {
    // Supabase Auth (anon key) is enough to create the auth.users row and hand
    // back a session, so signup/OAuth would otherwise look successful while
    // silently never writing the profile to the public "users" table - the
    // exact bug this function exists to prevent. If real Supabase Auth is in
    // play, the service-role key is required too; missing it is a
    // misconfiguration, not a valid "no persistence needed" state.
    if (supabaseAuth) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured; cannot persist the user profile.");
    return;
  }
  const { error } = await upsertResilient("users", [rowMappers.users.toRow(user)], "id");
  if (error) throw error;
}

async function deleteUserRow(userId: string) {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.from("users").delete().eq("id", userId);
  if (error) throw error;
}

// Some columns (reminded_user_ids, reminded_trigger_keys, ...) get added to a
// row mapper ahead of the matching Supabase migration actually being run -
// without this, upserting a row with a column the live table doesn't have
// yet fails the WHOLE write, not just that field, breaking basic things like
// creating a task until the migration catches up. Drop whichever column
// PostgREST reports missing and retry, so writes keep working either way;
// once the migration runs, nothing needs to change here.
async function upsertResilient(table: string, rows: Record<string, any>[], onConflict: string): Promise<{ error: Error | null }> {
  if (rows.length === 0) return { error: null };
  let currentRows = rows;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await supabaseAdmin!.from(table).upsert(currentRows, { onConflict });
    if (!error) return { error: null };
    const match = /Could not find the '([\w]+)' column/.exec(error.message);
    if (!match) return { error: new Error(error.message) };
    currentRows = currentRows.map((row) => {
      const { [match[1]]: _dropped, ...rest } = row;
      return rest;
    });
  }
  return { error: new Error(`Too many missing-column retries upserting into "${table}"`) };
}

// Sync one collection: delete rows no longer present locally, then upsert the current rows.
async function syncTable<T extends keyof typeof rowMappers>(table: T, localRows: any[]) {
  if (!supabaseAdmin) return;
  const mapper = rowMappers[table] as { toRow: (row: any) => any; fromRow: (row: any) => any };
  const { data: existing, error: fetchError } = await supabaseAdmin.from(table).select("id");
  if (fetchError) {
    console.error(`Error reading "${table}" from Supabase before sync:`, fetchError.message);
    return;
  }
  const localIds = new Set(localRows.map((r) => r.id));
  const toDelete = (existing || []).map((r: any) => r.id).filter((id: string) => !localIds.has(id));
  // Refuse to let a sync wipe out an entire table. A local snapshot with 0
  // rows while Supabase still has data is a sign the in-memory state is
  // stale, mid-reload, or coming from a second process racing the live
  // deployment - not genuine proof everything was deleted. Silently trusting
  // it here is exactly what turned a transient local hiccup into deleting
  // every real task/project/comment from the live database.
  if (existing && existing.length > 0 && toDelete.length === existing.length) {
    console.error(`Refusing to sync "${table}": local snapshot has ${localRows.length} row(s) but would delete all ${existing.length} row(s) in Supabase. Skipping the delete step to avoid data loss - upsert (if any local rows exist) still proceeds below.`);
  } else if (toDelete.length > 0) {
    const { error: deleteError } = await supabaseAdmin.from(table).delete().in("id", toDelete);
    if (deleteError) console.error(`Error deleting stale rows from "${table}":`, deleteError.message);
  }
  if (localRows.length > 0) {
    const { error: upsertError } = await upsertResilient(table, localRows.map(mapper.toRow), "id");
    if (upsertError) console.error(`Error upserting rows into "${table}":`, upsertError.message);
  }
}

// 1. Seed Supabase tables from local data.json if they are currently empty (tables/schema are pre-provisioned)
async function initializeSupabaseDatabase() {
  if (!supabaseAdmin) return;
  try {
    console.log("Verifying Supabase tables...");
    const { count, error } = await supabaseAdmin.from("users").select("id", { count: "exact", head: true });
    if (error) {
      console.error("Error verifying Supabase tables:", error.message);
      return;
    }
    if ((count || 0) > 0) {
      console.log("Supabase tables already contain data; skipping seed.");
      return;
    }

    console.log("Supabase tables are empty. Pre-populating Supabase with local data...");
    let localData: AppData;
    if (fs.existsSync(DATA_FILE)) {
      localData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    } else {
      localData = initialData;
    }

    await syncTable("users", localData.users || []);
    await syncTable("projects", localData.projects || []);
    await syncTable("tasks", localData.tasks || []);
    await syncTable("comments", localData.comments || []);
    await syncTable("notifications", localData.notifications || []);
    await syncTable("activity_logs", localData.activityLogs || []);
    await syncTable("goals", localData.goals || []);
    await syncTable("attendances", localData.attendances || []);
    await syncTable("leave_requests", localData.leaveRequests || []);
    await syncTable("calendar_events", localData.calendarEvents || []);

    const s = localData.settings || { reminderInDays: 3, enableEmailNotifications: true, enableUrgentAlerts: true, autoRiskAnalysis: true, eventReminderMinutesBefore: 10 };
    await supabaseAdmin.from("settings").upsert({
      id: 1, reminder_in_days: s.reminderInDays, enable_email_notifications: s.enableEmailNotifications,
      enable_urgent_alerts: s.enableUrgentAlerts, auto_risk_analysis: s.autoRiskAnalysis,
      event_reminder_minutes_before: s.eventReminderMinutesBefore ?? 10
    }, { onConflict: "id" });

    console.log("Supabase initial data pre-seeded successfully.");
  } catch (err) {
    console.error("Error verifying or seeding Supabase:", err);
  }
}

// 2. Fetch all rows from Supabase (via REST) and reassemble AppData state
async function loadMemoryDbFromSupabase() {
  if (!supabaseAdmin) return false;
  try {
    console.log('Loading live state from Supabase database...');

    const [
      usersRes, projectsRes, tasksRes, commentsRes, notificationsRes,
      activityLogsRes, settingsRes, goalsRes, attendancesRes, leaveRequestsRes, calendarEventsRes
    ] = await Promise.all([
      supabaseAdmin.from('users').select('*'),
      supabaseAdmin.from('projects').select('*'),
      supabaseAdmin.from('tasks').select('*'),
      supabaseAdmin.from('comments').select('*'),
      supabaseAdmin.from('notifications').select('*'),
      supabaseAdmin.from('activity_logs').select('*'),
      supabaseAdmin.from('settings').select('*').eq('id', 1).maybeSingle(),
      supabaseAdmin.from('goals').select('*'),
      supabaseAdmin.from('attendances').select('*'),
      supabaseAdmin.from('leave_requests').select('*'),
      supabaseAdmin.from('calendar_events').select('*')
    ]);

    // calendar_events is intentionally excluded from this strict check: it's a
    // newer table that may not exist yet in an older Supabase project (needs
    // a one-time migration the user runs manually). Failing the ENTIRE load
    // over one missing optional table would take down tasks/users/projects
    // too, so it degrades to an empty list instead.
    const results = { usersRes, projectsRes, tasksRes, commentsRes, notificationsRes, activityLogsRes, goalsRes, attendancesRes, leaveRequestsRes };
    for (const [name, res] of Object.entries(results)) {
      if ((res as any).error) throw new Error(`${name} query failed: ${(res as any).error.message}`);
    }
    if (settingsRes.error) throw new Error(`settingsRes query failed: ${settingsRes.error.message}`);
    if (calendarEventsRes.error) {
      console.warn("calendar_events table not available yet (run the migration to enable Team Calendar sync):", calendarEventsRes.error.message);
    }

    const db: AppData = {
      users: (usersRes.data || []).map(rowMappers.users.fromRow),
      projects: (projectsRes.data || []).map(rowMappers.projects.fromRow),
      tasks: (tasksRes.data || []).map(rowMappers.tasks.fromRow),
      comments: (commentsRes.data || []).map(rowMappers.comments.fromRow),
      notifications: (notificationsRes.data || []).map(rowMappers.notifications.fromRow),
      activityLogs: (activityLogsRes.data || []).map(rowMappers.activity_logs.fromRow),
      settings: settingsRes.data
        ? {
            reminderInDays: settingsRes.data.reminder_in_days,
            enableEmailNotifications: settingsRes.data.enable_email_notifications,
            enableUrgentAlerts: settingsRes.data.enable_urgent_alerts,
            autoRiskAnalysis: settingsRes.data.auto_risk_analysis,
            eventReminderMinutesBefore: settingsRes.data.event_reminder_minutes_before ?? 10
          }
        : { reminderInDays: 3, enableEmailNotifications: true, enableUrgentAlerts: true, autoRiskAnalysis: true, eventReminderMinutesBefore: 10 },
      goals: (goalsRes.data || []).map(rowMappers.goals.fromRow),
      attendances: (attendancesRes.data || []).map(rowMappers.attendances.fromRow),
      leaveRequests: (leaveRequestsRes.data || []).map(rowMappers.leave_requests.fromRow),
      calendarEvents: (calendarEventsRes.data || []).map(rowMappers.calendar_events.fromRow)
    };

    memoryDb = db;
    console.log(`Successfully loaded database state from Supabase (${db.tasks.length} tasks, ${db.projects.length} projects).`);
    return true;
  } catch (err) {
    console.error('Error loading database state from Supabase:', err);
    return false;
  }
}

// 3. Sync memoryDb to Supabase (upserts current rows, deletes rows no longer present locally).
// Runs are serialized on a promise chain (rather than a skip-if-busy flag) so that
// every caller's `await syncMemoryDbToSupabase()` is guaranteed to resolve only once
// a sync that reflects their own write has actually completed. On a serverless host
// the request/response can end the moment the handler returns, so a "fire and skip"
// sync (the old isSyncing/pendingSync guard) could get dropped entirely before it
// ever ran, silently losing the write.
let syncChain: Promise<void> = Promise.resolve();
function syncMemoryDbToSupabase(): Promise<void> {
  if (!supabaseAdmin || !memoryDb) return Promise.resolve();
  const run = syncChain.then(doSyncMemoryDbToSupabase, doSyncMemoryDbToSupabase);
  syncChain = run;
  return run;
}

async function doSyncMemoryDbToSupabase() {
  if (!supabaseAdmin || !memoryDb) return;
  try {
    const db = JSON.parse(JSON.stringify(memoryDb)); // Deep copy to prevent race conditions during express routing updates

    // "users" is deliberately NOT synced here. This function runs after every
    // write to any table, on whichever serverless instance happened to handle
    // that request - and each instance's memoryDb.users can be a couple
    // seconds stale relative to Supabase (see the throttled per-request
    // reload above). syncTable deletes any Supabase row missing from the
    // local snapshot, so an unrelated write (e.g. someone dismissing a
    // notification) on a stale instance would silently delete a user who
    // signed up moments earlier on a different instance. Every route that
    // creates/updates/deletes a user does so explicitly via persistUserRow /
    // deleteUserRow instead, so this table never needs the generic sync.
    await syncTable('projects', db.projects);
    await syncTable('tasks', db.tasks);
    await syncTable('comments', db.comments);
    await syncTable('notifications', db.notifications);
    await syncTable('activity_logs', db.activityLogs);
    await syncTable('goals', db.goals);
    await syncTable('attendances', db.attendances || []);
    await syncTable('leave_requests', db.leaveRequests || []);
    await syncTable('calendar_events', db.calendarEvents || []);

    const s = db.settings || { reminderInDays: 3, enableEmailNotifications: true, enableUrgentAlerts: true, autoRiskAnalysis: true, eventReminderMinutesBefore: 10 };
    const { error: settingsError } = await supabaseAdmin.from('settings').upsert({
      id: 1, reminder_in_days: s.reminderInDays, enable_email_notifications: s.enableEmailNotifications,
      enable_urgent_alerts: s.enableUrgentAlerts, auto_risk_analysis: s.autoRiskAnalysis,
      event_reminder_minutes_before: s.eventReminderMinutesBefore ?? 10
    }, { onConflict: 'id' });
    if (settingsError) console.error('Error upserting settings into Supabase:', settingsError.message);

    console.log('Live state synchronized to Supabase successfully.');
  } catch (err) {
    console.error('Error synchronizing state to Supabase:', err);
  }
}


// Helper load/save databases
function readDatabase(): AppData {
  if (memoryDb) {
    return memoryDb;
  }

  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, "utf-8");
      const db = JSON.parse(data);
      if (!db.goals) {
        db.goals = [];
      }
      if (!db.attendances) {
        db.attendances = [];
      }
      if (!db.leaveRequests) {
        db.leaveRequests = [];
      }
      if (!db.calendarEvents) {
        db.calendarEvents = [];
      }
      if (db.settings && db.settings.eventReminderMinutesBefore === undefined) {
        db.settings.eventReminderMinutesBefore = 10;
      }

      // Dynamic migration on load
      let needsWrite = false;
      if (db.tasks && Array.isArray(db.tasks)) {
        db.tasks = db.tasks.map((task: any) => {
          const mappedStage = mapStage(task.stage);
          const correctStage = task.status === "Completed"
            ? "Completed"
            : task.timerState === "running"
              ? "In Progress"
              : mappedStage;
          const correctStatus = task.timerState === "running" && task.status !== "Completed"
            ? "In Progress"
            : task.status;
          if (task.stage !== correctStage || task.status !== correctStatus) {
            needsWrite = true;
            return { ...task, stage: correctStage, status: correctStatus };
          }
          return task;
        });
      }
      
      if (needsWrite) {
        writeDatabase(db);
      }
      
      memoryDb = db;
      return db;
    }
  } catch (error) {
    console.error("Failed to read database file, restoring defaults:", error);
  }
  
  // Clean initial data too
  if (initialData.tasks) {
    initialData.tasks = initialData.tasks.map((t: any) => ({
      ...t,
      stage: mapStage(t.stage)
    }));
  }
  
  // Store default if doesn't exist
  writeDatabase(initialData);
  memoryDb = initialData;
  return initialData;
}

// Callers that can afford to (route handlers that haven't already responded)
// should `await` this so the write is durably in Supabase before the HTTP
// response goes out - see syncMemoryDbToSupabase() for why that matters on
// a serverless host. Callers that don't await it keep the old fire-and-forget
// behavior, which is fine for local/persistent hosts.
function writeDatabase(data: AppData): Promise<void> {
  memoryDb = data;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write database file:", error);
  }

  if (supabaseAdmin) {
    return syncMemoryDbToSupabase();
  }
  return Promise.resolve();
}

// Automatic reminder scheduler scanner
// Analyzes all uncompleted tasks and automatically appends overdue or pending notifications
function runReminderScanner() {
  const db = readDatabase();
  const today = new Date("2026-07-08T01:46:43-07:00"); // Standard mock time representing the system state
  let updated = false;

  db.tasks.forEach((task) => {
    if (task.status === "Completed") return;

    const dueDate = new Date(task.dueDate);
    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Automated Alert/Notification Creation Rules:
    let message = "";
    let notifyType: "info" | "success" | "warning" | "error" = "info";
    let triggerKey = "";

    if (diffDays < 0) {
      // Overdue
      message = `🚨 OVERDUE ALERT: Task "${task.title}" (${task.id}) was due on ${new Date(task.dueDate).toLocaleDateString()}. Code Status is pending.`;
      notifyType = "error";
      triggerKey = `overdue-${task.id}`;
    } else if (diffDays === 0) {
      // Due Today
      message = `⚡ HIGH-PRIORITY ALERT: Task "${task.title}" (${task.id}) is due TODAY!`;
      notifyType = "warning";
      triggerKey = `today-${task.id}`;
    } else if (diffDays === 1) {
      // Due in 1 Day
      message = `⚠️ URGENT REMINDER: Task "${task.title}" (${task.id}) is due tomorrow!`;
      notifyType = "warning";
      triggerKey = `day1-${task.id}`;
    } else if (diffDays <= 3 && diffDays > 1) {
      // Due in 3 days
      message = `📅 Reminder: Task "${task.title}" (${task.id}) is due in ${diffDays} days.`;
      notifyType = "info";
      triggerKey = `day3-${task.id}`;
    }

    if (message) {
      // Whether this was already sent is tracked on the task itself, not by
      // scanning for a matching notification - scanning breaks the moment
      // the user dismisses it (Dismiss All deletes notifications outright),
      // since the scanner would then see no record and recreate the exact
      // same alert on the very next /api/tasks fetch. Same fix as the
      // calendar-event reminder loop, applied here too.
      if (!task.remindedTriggerKeys) task.remindedTriggerKeys = [];
      if (!task.remindedTriggerKeys.includes(triggerKey)) {
        task.remindedTriggerKeys.push(triggerKey);
        db.notifications.unshift({
          id: `not-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          userId: task.assignedTo,
          message,
          type: notifyType,
          readStatus: false,
          createdAt: today.toISOString()
        });
        updated = true;
      }
    }
  });

  if (updated) {
    writeDatabase(db);
  }
}

// Calendar event reminders are minute-granular ("10 min before a 3pm
// meeting"), so unlike runReminderScanner's day-granularity task reminders
// (which use a fixed mock "today" for demo consistency), this needs the
// real wall-clock time to mean anything.
function runEventReminderScanner() {
  const db = readDatabase();
  if (!db.calendarEvents || db.calendarEvents.length === 0) return;

  const leadMinutes = db.settings?.eventReminderMinutesBefore ?? 10;
  const now = Date.now();
  let updated = false;

  db.calendarEvents.forEach((event) => {
    // The date/time picker is filled in by India-based users (IST, UTC+5:30),
    // but a bare "YYYY-MM-DDTHH:MM:00" string is parsed in whatever timezone
    // the Node process itself runs in - Vercel's serverless functions default
    // to UTC, not IST. Without an explicit offset this silently reinterprets
    // "3pm" as 3pm UTC (8:30pm IST), so the reminder window opens 5.5 hours
    // later than the user actually meant - which reads as "never arrived".
    const eventTime = new Date(`${event.dueDate}T${event.time}:00+05:30`).getTime();
    if (Number.isNaN(eventTime)) return;
    const reminderTime = eventTime - leadMinutes * 60000;

    // Only fire within the reminder window itself (not before it opens, and
    // not once the event has already started) - a scan cadence of a few
    // seconds/minutes means this window is what actually catches the moment.
    if (now < reminderTime || now >= eventTime) return;

    // Whether a reminder already fired is tracked on the event itself, not
    // by scanning for a matching notification - "Dismiss All" deletes
    // notifications outright, and if that were the only record, dismissing
    // the reminder while the event's window was still open would make the
    // scanner think it never sent one and immediately recreate it, which is
    // exactly the "reminder keeps coming back" loop this fixes.
    if (!event.remindedUserIds) event.remindedUserIds = [];
    event.assigneeIds.forEach((userId) => {
      if (event.remindedUserIds!.includes(userId)) return;
      event.remindedUserIds!.push(userId);
      db.notifications.unshift({
        id: `not-${Date.now()}-${Math.floor(Math.random() * 1000)}-evt`,
        userId,
        message: `⏰ EVENT REMINDER: "${event.title}" starts at ${event.time} today (in ~${leadMinutes} min). (${event.id})`,
        type: "warning",
        readStatus: false,
        createdAt: new Date().toISOString()
      });
      updated = true;
    });
  });

  if (updated) {
    writeDatabase(db);
  }
}

// Initial Reminder Run on Server Startup
runReminderScanner();

// API Endpoints:

app.get("/api/auth/config", (_req, res) => {
  if (!supabaseUrl || !supabaseAnonKey) return res.status(503).json({ error: "Supabase Auth is not configured." });
  res.json({ url: supabaseUrl, publishableKey: supabaseAnonKey });
});

app.post("/api/auth/oauth-profile", async (req, res) => {
  if (!supabaseAuth) return res.status(503).json({ error: "Supabase Auth is not configured." });
  const token = String(req.body?.accessToken || "");
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data.user?.email) return res.status(401).json({ error: "Invalid OAuth session." });
  const db = readDatabase();
  let user = db.users.find(u => u.email.toLowerCase() === data.user.email!.toLowerCase());
  if (!user) {
    user = { id: data.user.id, name: data.user.user_metadata?.full_name || data.user.user_metadata?.name || data.user.email.split("@")[0], email: data.user.email, role: "Team Member", department: "General", avatar: data.user.user_metadata?.avatar_url, createdAt: new Date().toISOString() };
    db.users.push(user);
    try {
      await persistUserRow(user);
      void writeDatabase(db);
    } catch (err: any) {
      db.users.pop();
      console.error("OAuth profile persistence failed:", err.message);
      return res.status(500).json({ error: "Could not save your account. Please try signing in again." });
    }
  }
  res.json({ success: true, user, token });
});

// 1. AUTH: Email + password authentication via Supabase Auth.
// Falls back to local mock login (no password check) if Supabase Auth isn't configured yet.
app.post("/api/auth/login", async (req, res) => {
  const { email, password, googleLogin } = req.body;
  const db = readDatabase();

  let user = db.users.find((u) => u.email.toLowerCase() === email?.toLowerCase());

  if (googleLogin) {
    // Google sign-on shortcut: no password required
    if (!user) {
      const isGmailTushar = email?.toLowerCase() === "tushar.handysolver@gmail.com";
      user = {
        id: `usr-${Date.now()}`,
        name: isGmailTushar ? "Tushar Handysolver" : email.split("@")[0],
        email: email,
        role: isGmailTushar ? "Team Member" : "Manager",
        department: isGmailTushar ? "Engineering" : "Operations",
        avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150",
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      try {
        await persistUserRow(user);
      } catch (err: any) {
        db.users.pop();
        console.error("Google login profile persistence failed:", err.message);
        return res.status(500).json({ error: "Could not save your account. Please try signing in again." });
      }
      void writeDatabase(db);
    }
    return res.json({ success: true, token: `mock-jwt-token-for-${user.id}`, user });
  }

  if (supabaseAuth) {
    if (!password) {
      return res.status(400).json({ error: "Password is required." });
    }
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return res.status(401).json({ error: error?.message || "Invalid email or password." });
    }
    if (!user) {
      // First login after a Supabase-side account exists but no local profile yet
      user = {
        id: data.user!.id,
        name: (data.user!.user_metadata as any)?.name || email.split("@")[0],
        email: email.toLowerCase(),
        role: ((data.user!.user_metadata as any)?.role as any) || "Team Member",
        department: (data.user!.user_metadata as any)?.department || "General",
        avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150",
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      try {
        await persistUserRow(user);
      } catch (err: any) {
        db.users.pop();
        console.error("First-login profile persistence failed:", err.message);
        return res.status(500).json({ error: "Could not save your account. Please try signing in again." });
      }
      void writeDatabase(db);
    }
    return res.json({ success: true, token: data.session.access_token, user });
  }

  // Fallback: no Supabase Auth configured yet
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials. Try sarah@company.com or marcus@company.com" });
  }
  res.json({ success: true, token: `mock-jwt-token-for-${user.id}`, user });
});

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password, role, department, termsAccepted } = req.body;
  const db = readDatabase();

  if (!name || !email || !role || !department) {
    return res.status(400).json({ error: "All fields (Name, Email, Role, Department) are required." });
  }

  if (supabaseAuth && !password) {
    return res.status(400).json({ error: "Password is required." });
  }

  if (!termsAccepted) {
    return res.status(400).json({ error: "You must accept the Terms and Conditions to register." });
  }

  let newUserId = `usr-${Date.now()}`;

  if (supabaseAuth) {
    // Supabase is the source of truth for whether this email is taken; the local
    // data.json copy can go stale (e.g. a user deleted from Supabase directly), so
    // don't pre-block signup based on it - let Supabase's own signUp call decide.
    const { data, error } = await supabaseAuth.auth.signUp({
      email,
      password,
      options: { data: { name, role, department } }
    });
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    newUserId = data.user!.id;
  } else if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    // No Supabase configured - data.json is the only source of truth, so check it directly.
    return res.status(400).json({ error: "A user with this email already exists." });
  }

  // Drop any stale local record for this email (e.g. left over from a previous
  // signup attempt whose Supabase account no longer exists) before re-adding it.
  db.users = db.users.filter((u) => u.email.toLowerCase() !== email.toLowerCase());

  const newUser = {
    id: newUserId,
    name,
    email: email.toLowerCase(),
    role: role as "Admin" | "Manager" | "Team Member",
    department,
    avatar: `https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150`, // fallback
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);

  try {
    await persistUserRow(newUser);
    void writeDatabase(db);
  } catch (error: any) {
    db.users.pop();
    console.error("Signup persistence failed:", error.message);
    return res.status(500).json({ error: "Could not save your account. Please try registering again." });
  }

  res.status(201).json({
    success: true,
    user: newUser,
    token: `mock-jwt-token-for-${newUser.id}`
  });
});

// Create/Update Users API
app.get("/api/users", (req, res) => {
  const db = readDatabase();
  res.json(db.users);
});

app.put("/api/users/:id", async (req, res) => {
  const { id } = req.params;
  const { name, phone, role, avatar } = req.body;
  const db = readDatabase();
  const userIndex = db.users.findIndex((u) => u.id === id);

  if (userIndex === -1) return res.status(404).json({ error: "User not found" });
  if (!name?.trim()) return res.status(400).json({ error: "Username is required" });

  const requestedRole = ["Admin", "Manager", "Team Member"].includes(role) ? role : db.users[userIndex].role;
  const actor = db.users.find((u) => u.id === String(req.header("x-user-id") || ""));
  if (requestedRole !== db.users[userIndex].role && actor?.role !== "Admin") {
    return res.status(403).json({ error: "Only an admin can change user roles." });
  }

  const previousUser = db.users[userIndex];
  db.users[userIndex] = {
    ...previousUser,
    name: name.trim(),
    phone: phone?.trim() || "",
    role: requestedRole,
    avatar: avatar?.trim() ? avatar : previousUser.avatar
  };

  try {
    await persistUserRow(db.users[userIndex]);
  } catch (err: any) {
    db.users[userIndex] = previousUser;
    console.error("User update persistence failed:", err.message);
    return res.status(500).json({ error: "Could not save the changes. Please try again." });
  }
  void writeDatabase(db);
  res.json(db.users[userIndex]);
});

app.post("/api/users", async (req, res) => {
  const { name, email, role, department, avatar } = req.body;
  const db = readDatabase();

  if (!name || !email || !role || !department) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: "User with this email already exists" });
  }

  const newUser = {
    id: `usr-${Date.now()}`,
    name,
    email,
    role: role as "Admin" | "Manager" | "Team Member",
    department,
    avatar: avatar || `https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150`, // fallback default avatar
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);

  try {
    await persistUserRow(newUser);
  } catch (err: any) {
    db.users.pop();
    console.error("User creation persistence failed:", err.message);
    return res.status(500).json({ error: "Could not save the new user. Please try again." });
  }
  void writeDatabase(db);

  res.status(201).json(newUser);
});

app.delete("/api/users/:id", async (req, res) => {
  const { id } = req.params;
  const db = readDatabase();

  try {
    await deleteUserRow(id);
  } catch (err: any) {
    console.error("User deletion persistence failed:", err.message);
    return res.status(500).json({ error: "Could not delete the user. Please try again." });
  }

  db.users = db.users.filter((u) => u.id !== id);
  void writeDatabase(db);
  res.json({ success: true });
});

// Projects API
app.get("/api/projects", (req, res) => {
  const db = readDatabase();
  res.json(db.projects);
});

app.post("/api/projects", async (req, res) => {
  const { name, description, clientName, matterCode, practiceArea, status, budget, clientEmail, clientPhone } = req.body;
  const db = readDatabase();

  if (!name) {
    return res.status(400).json({ error: "Project name is required" });
  }

  const newProject = {
    id: `prj-${Date.now()}`,
    name,
    description: description || "",
    clientName: clientName || "",
    matterCode: matterCode || `MC-${Math.floor(1000 + Math.random() * 9000)}`,
    practiceArea: practiceArea || "General",
    status: (status || "Active") as "Active" | "On Hold" | "Closed",
    budget: budget ? Number(budget) : 0,
    clientEmail: clientEmail || "",
    clientPhone: clientPhone || "",
    createdAt: new Date().toISOString()
  };

  db.projects.push(newProject);
  await writeDatabase(db);

  res.status(201).json(newProject);
});

app.put("/api/projects/:id", async (req, res) => {
  const { id } = req.params;
  const { name, description, clientName, matterCode, practiceArea, status, budget, clientEmail, clientPhone } = req.body;
  const db = readDatabase();

  const prjIndex = db.projects.findIndex((p) => p.id === id);
  if (prjIndex === -1) {
    return res.status(404).json({ error: "Project not found." });
  }

  const project = db.projects[prjIndex];
  const oldName = project.name;

  if (name !== undefined) project.name = name;
  if (description !== undefined) project.description = description;
  if (clientName !== undefined) project.clientName = clientName;
  if (matterCode !== undefined) project.matterCode = matterCode;
  if (practiceArea !== undefined) project.practiceArea = practiceArea;
  if (status !== undefined) project.status = status as "Active" | "On Hold" | "Closed";
  if (budget !== undefined) project.budget = budget ? Number(budget) : 0;
  if (clientEmail !== undefined) project.clientEmail = clientEmail;
  if (clientPhone !== undefined) project.clientPhone = clientPhone;

  if (name && name !== oldName) {
    db.tasks = db.tasks.map((t) => {
      if (t.projectId === id) {
        return { ...t, projectName: name };
      }
      return t;
    });
  }

  await writeDatabase(db);
  res.json(project);
});

// Tasks API
app.get("/api/tasks", (req, res) => {
  // Let's run a check on reminders before returning tasks
  runReminderScanner();
  const db = readDatabase();
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.json(db.tasks);
});

app.post("/api/tasks", async (req, res) => {
  const { title, description, priority, stage, dueDate, assignedTo, projectId, tags, estimatedHours, attachments, isBillable, hourlyRate, clientApprovalStatus, matterCode, createdBy } = req.body;
  const db = readDatabase();

  if (!title?.trim() || !dueDate || !assignedTo || !projectId || !createdBy) {
    return res.status(400).json({ error: "Title, Due Date, Assignee and Project are required." });
  }

  const project = db.projects.find((p) => p.id === projectId);
  const assignee = db.users.find((u) => u.id === assignedTo);
  const creator = db.users.find((u) => u.id === createdBy);
  if (!project) {
    return res.status(400).json({ error: "Please select a valid project." });
  }
  if (!assignee) {
    return res.status(400).json({ error: "Please select a valid assignee." });
  }
  if (!creator) {
    return res.status(401).json({ error: "Your login session is no longer valid. Please sign in again." });
  }

  // Generate complete sequence Task ID
  const highestTaskNumber = db.tasks.reduce((highest, task) => {
    const match = /^TSK-(\d+)$/.exec(task.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 1005);
  const nextNum = highestTaskNumber + 1;

  const nextId = `TSK-${nextNum}`;

  const newTask = {
    id: nextId,
    title: title.trim(),
    description: description || "",
    priority: (priority || "Medium") as "Critical" | "High" | "Medium" | "Low",
    status: "Not Started" as const,
    stage: (stage || "Case Intake") as "Case Intake" | "In Progress" | "Completed",
    dueDate,
    createdAt: new Date().toISOString(),
    lastUpdatedDate: new Date().toISOString(),
    assignedBy: creator.id,
    assignedTo,
    projectId,
    projectName: project.name,
    tags: tags || [],
    estimatedHours: estimatedHours ? Number(estimatedHours) : 0,
    actualHours: 0,
    attachments: attachments || [],
    isBillable: isBillable !== undefined ? Boolean(isBillable) : true,
    hourlyRate: hourlyRate !== undefined ? Number(hourlyRate) : 250,
    clientApprovalStatus: clientApprovalStatus || "Not Required",
    matterCode: matterCode || ""
  };

  db.tasks.push(newTask);

  // Send real-time mock notification on creation
  db.notifications.unshift({
    id: `not-${Date.now()}`,
    userId: assignedTo,
    message: `📋 NEW TASK ASSIGNED: "${title}" (${nextId}) assigned to you. Due on ${new Date(dueDate).toLocaleDateString()}`,
    type: "info",
    readStatus: false,
    createdAt: new Date().toISOString()
  });

  // Log activity
  db.activityLogs.unshift({
    id: `log-${Date.now()}`,
    taskId: nextId,
    userId: creator.id,
    userName: creator.name,
    action: `Created task ${nextId} and assigned to ${assignee?.name || "Team member"}`,
    timestamp: new Date().toISOString()
  });

  try {
    // Persist just the new task row before responding (fast, single upsert);
    // the full multi-table resync (notifications/activity log/etc.) runs in
    // the background, same pattern as the play/pause/complete/PUT endpoints -
    // it avoids blocking the response on a 9-table sync round-trip.
    await persistTaskRow(newTask);
    void writeDatabase(db);
    res.status(201).json(newTask);
  } catch (error) {
    db.tasks.pop();
    db.notifications.shift();
    db.activityLogs.shift();
    console.error("Task creation failed:", error);
    res.status(500).json({ error: "Task could not be saved. Please try again." });
  }
});

// Update Task (Full details or single-property drags)
app.put("/api/tasks/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const db = readDatabase();

  const taskIndex = db.tasks.findIndex((t) => t.id === id);
  if (taskIndex === -1) {
    return res.status(404).json({ error: "Task not found." });
  }

  const task = db.tasks[taskIndex];
  const oldStage = task.stage;
  const oldStatus = task.status;

  // Track changed elements for activity logging
  let actionDetails = "Updated task details";
  if (updates.stage && updates.stage !== oldStage) {
    actionDetails = `Moved from Stage "${oldStage}" to "${updates.stage}"`;
    // Stage and status are a single workflow: completed always lives in Completed.
    if (updates.stage === "Completed") {
      updates.status = "Completed";
    } else if (task.status === "Completed") {
      updates.status = "In Progress";
    }
  }

  if (updates.status && updates.status !== oldStatus) {
    actionDetails = `Updated Task status from "${oldStatus}" to "${updates.status}"`;
    if (updates.status === "Completed") {
      updates.stage = "Completed";
      updates.timerState = "idle";
      updates.lastStartedAt = null;
    } else if (oldStatus === "Completed" && (!updates.stage || updates.stage === "Completed")) {
      updates.stage = updates.status === "Not Started" ? "Case Intake" : "In Progress";
    }
  }

  // Calculate and store timestamps for In Progress and Completed status changes
  const finalStatus = updates.status !== undefined ? updates.status : task.status;
  if (finalStatus === "In Progress" && task.status !== "In Progress") {
    updates.startedAt = new Date().toISOString();
  } else if (finalStatus === "Completed" && task.status !== "Completed") {
    updates.completedAt = new Date().toISOString();
    const startIso = task.startedAt || updates.startedAt;
    if (startIso) {
      const startTime = new Date(startIso).getTime();
      const endTime = new Date(updates.completedAt).getTime();
      const diffMs = endTime - startTime;
      if (diffMs > 0) {
        const diffHours = diffMs / (1000 * 60 * 60);
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        updates.actualHoursElapsed = parseFloat(diffHours.toFixed(2));
        updates.actualDaysElapsed = parseFloat(diffDays.toFixed(2));
      } else {
        updates.actualHoursElapsed = 0;
        updates.actualDaysElapsed = 0;
      }
    }
  } else if (finalStatus === "Not Started") {
    updates.startedAt = null;
    updates.completedAt = null;
    updates.actualHoursElapsed = null;
    updates.actualDaysElapsed = null;
  } else if (finalStatus !== "Completed" && task.status === "Completed") {
    // If it was Completed and now it's not, reset completion metrics
    updates.completedAt = null;
    updates.actualHoursElapsed = null;
    updates.actualDaysElapsed = null;
  }

  const updatedTask = {
    ...task,
    ...updates,
    lastUpdatedDate: new Date().toISOString()
  };

  db.tasks[taskIndex] = updatedTask;

  // Completing a task via drag-to-Completed / the edit modal (as opposed to
  // the dedicated timer /complete endpoint above) still deserves the same
  // Admin heads-up.
  if (finalStatus === "Completed" && oldStatus !== "Completed") {
    notifyAdminsOfTaskCompletion(db, updatedTask, updates.editorName || "Team member");
  }

  // Notify Assignee of updates
  if (updatedTask.assignedTo) {
    db.notifications.unshift({
      id: `not-${Date.now()}`,
      userId: updatedTask.assignedTo,
      message: `🔔 TASK UPDATED: "${updatedTask.title}" (${updatedTask.id}). Change: ${actionDetails}`,
      type: updatedTask.status === "Completed" ? "success" : "info",
      readStatus: false,
      createdAt: new Date().toISOString()
    });
  }

  // Activity Log
  db.activityLogs.unshift({
    id: `log-${Date.now()}`,
    taskId: id,
    userId: updates.editorId || "usr-2",
    userName: updates.editorName || "System Moderator",
    action: actionDetails,
    timestamp: new Date().toISOString()
  });

  try {
    await persistTaskRow(updatedTask);
    void writeDatabase(db);
    res.json(updatedTask);
  } catch (error) {
    db.tasks[taskIndex] = task;
    db.notifications.shift();
    db.activityLogs.shift();
    console.error("Task update persistence failed:", error);
    res.status(500).json({ error: "Task update could not be saved. Please try again." });
  }
});

// Comments API
app.get("/api/tasks/:id/comments", (req, res) => {
  const { id } = req.params;
  const db = readDatabase();
  const taskComments = db.comments.filter((c) => c.taskId === id);
  res.json(taskComments);
});

app.post("/api/tasks/:id/comments", async (req, res) => {
  const { id } = req.params;
  const { comment, userId, userName } = req.body;
  const db = readDatabase();

  if (!comment || !userId) {
    return res.status(400).json({ error: "Comment content and user credentials are required" });
  }

  const task = db.tasks.find((t) => t.id === id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const newComment = {
    id: `com-${Date.now()}`,
    taskId: id,
    userId,
    userName: userName || "Anonymous Collaborator",
    comment,
    createdAt: new Date().toISOString()
  };

  db.comments.push(newComment);

  // A comment is also a durable audit event, making it available to user-history AI queries.
  db.activityLogs.unshift({
    id: `log-${Date.now()}-comment`,
    taskId: id,
    userId,
    userName: userName || "Anonymous Collaborator",
    action: `Commented on task: ${comment}`,
    timestamp: newComment.createdAt
  });

  // Send notification to another user if commented
  const alertTarget = task.assignedTo === userId ? task.assignedBy : task.assignedTo;
  db.notifications.unshift({
    id: `not-${Date.now()}`,
    userId: alertTarget,
    message: `💬 COMMENT ADDED: ${userName} commented on "${task.title}": "${comment.substring(0, 40)}${comment.length > 40 ? "..." : ""}"`,
    type: "info",
    readStatus: false,
    createdAt: new Date().toISOString()
  });

  await writeDatabase(db);
  res.status(201).json(newComment);
});

// Notifications API
app.get("/api/notifications", (req, res) => {
  // Frontend polls this endpoint every 8s while logged in, which makes it a
  // convenient, always-warm hook for scanning upcoming calendar events.
  runEventReminderScanner();
  const { userId } = req.query;
  const db = readDatabase();

  let userNotifications = db.notifications;
  if (userId) {
    userNotifications = db.notifications.filter((n) => n.userId === userId);
  }

  res.json(userNotifications);
});

app.post("/api/notifications/:id/read", async (req, res) => {
  const { id } = req.params;
  const db = readDatabase();

  const note = db.notifications.find((n) => n.id === id);
  if (note) {
    note.readStatus = true;
    await writeDatabase(db);
  }

  res.json({ success: true });
});

// "Dismiss All" clears the user's notifications outright (not just marks them
// read) - the notification center is meant to empty out, not fill up with
// grayed-out entries the user already dismissed.
app.post("/api/notifications/read-all", async (req, res) => {
  const { userId } = req.body;
  const db = readDatabase();

  db.notifications = db.notifications.filter((n) => n.userId !== userId);

  void writeDatabase(db);
  res.json({ success: true });
});

// Team Calendar events API. Shared across every assignee's device (unlike
// the old localStorage-only version), so the reminder scan above can notify
// everyone assigned, not just whoever's browser created the event.
app.get("/api/events", (req, res) => {
  runEventReminderScanner();
  const db = readDatabase();
  res.json(db.calendarEvents || []);
});

app.post("/api/events", async (req, res) => {
  const { title, description, dueDate, time, assigneeIds, createdBy } = req.body;
  const db = readDatabase();

  if (!title?.trim() || !dueDate || !time || !Array.isArray(assigneeIds) || assigneeIds.length === 0) {
    return res.status(400).json({ error: "Title, date, time and at least one assignee are required." });
  }

  const newEvent = {
    id: `evt-${Date.now()}`,
    title: title.trim(),
    description: description || "",
    dueDate,
    time,
    assigneeIds,
    createdBy: createdBy || "",
    createdAt: new Date().toISOString()
  };

  if (!db.calendarEvents) db.calendarEvents = [];
  db.calendarEvents.push(newEvent);

  try {
    if (supabaseAdmin) {
      const { error } = await upsertResilient("calendar_events", [rowMappers.calendar_events.toRow(newEvent)], "id");
      if (error) {
        db.calendarEvents.pop();
        console.error("Event creation failed in Supabase:", error.message);
        return res.status(500).json({ error: "Event could not be saved. Please try again." });
      }
    }
    void writeDatabase(db);
    res.status(201).json(newEvent);
  } catch (error) {
    db.calendarEvents.pop();
    console.error("Event creation failed:", error);
    res.status(500).json({ error: "Event could not be saved. Please try again." });
  }
});

app.delete("/api/events/:id", async (req, res) => {
  const { id } = req.params;
  const db = readDatabase();
  db.calendarEvents = (db.calendarEvents || []).filter((e) => e.id !== id);
  void writeDatabase(db);
  res.json({ success: true });
});

// Settings API
app.get("/api/settings", (req, res) => {
  const db = readDatabase();
  res.json(db.settings);
});

app.post("/api/settings", async (req, res) => {
  const updates = req.body;
  const db = readDatabase();

  db.settings = {
    ...db.settings,
    ...updates
  };

  await writeDatabase(db);
  res.json(db.settings);
});

// Fetch Task Activity Logs
app.get("/api/tasks/:id/activity", (req, res) => {
  const { id } = req.params;
  const db = readDatabase();
  const logs = db.activityLogs.filter((log) => log.taskId === id);
  res.json(logs);
});

// ==========================================
// Goals & Accountable Tracking APIs
// ==========================================

app.get("/api/goals", (req, res) => {
  const db = readDatabase();
  res.json(db.goals || []);
});

app.post("/api/goals", async (req, res) => {
  const { title, description, assignedTo, accountable, assignedBy, targetDate } = req.body;
  const db = readDatabase();

  if (!title || !assignedTo || !accountable || !assignedBy) {
    return res.status(400).json({ error: "Goal title, Assigned Worker, Accountable Leader, and Creator are required." });
  }

  const newGoal = {
    id: `G-${Date.now()}`,
    title,
    description: description || "",
    assignedTo,
    accountable,
    assignedBy,
    targetDate: targetDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    progress: 0,
    status: "Not Started" as const,
    accountableNotes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!db.goals) db.goals = [];
  db.goals.unshift(newGoal);

  const getMemberName = (id: string) => {
    const found = db.users.find((u) => u.id === id);
    return found ? found.name : "Team Member";
  };

  const assignedToName = getMemberName(assignedTo);
  const accountableName = getMemberName(accountable);
  const assignerName = getMemberName(assignedBy);

  // Notify Assigned Worker
  db.notifications.unshift({
    id: `not-${Date.now()}-g1`,
    userId: assignedTo,
    message: `🎯 NEW GOAL ASSIGNED: You are assigned to work on "${title}". ${accountableName} is accountable.`,
    type: "info",
    readStatus: false,
    createdAt: new Date().toISOString()
  });

  // Notify Accountable Person
  if (accountable !== assignedTo) {
    db.notifications.unshift({
      id: `not-${Date.now()}-g2`,
      userId: accountable,
      message: `🛡️ ACCOUNTABILITY DELEGATED: You are accountable for "${title}" which is being worked on by ${assignedToName}.`,
      type: "info",
      readStatus: false,
      createdAt: new Date().toISOString()
    });
  }

  // Notify Assigner (Creator)
  if (assignedBy !== assignedTo && assignedBy !== accountable) {
    db.notifications.unshift({
      id: `not-${Date.now()}-g3`,
      userId: assignedBy,
      message: `🎯 GOAL CONFIGURED: "${title}" created. Assigned to ${assignedToName} (Accountable: ${accountableName}).`,
      type: "success",
      readStatus: false,
      createdAt: new Date().toISOString()
    });
  }

  await writeDatabase(db);
  res.status(201).json(newGoal);
});

app.put("/api/goals/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const db = readDatabase();

  if (!db.goals) db.goals = [];
  const goalIndex = db.goals.findIndex((g) => g.id === id);
  if (goalIndex === -1) {
    return res.status(404).json({ error: "Goal not found" });
  }

  const existingGoal = db.goals[goalIndex];
  const oldProgress = existingGoal.progress;
  const oldStatus = existingGoal.status;

  const updatedGoal = {
    ...existingGoal,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  db.goals[goalIndex] = updatedGoal;

  const getMemberName = (uid: string) => {
    const found = db.users.find((u) => u.id === uid);
    return found ? found.name : "Personnel";
  };

  const performerName = getMemberName(updatedGoal.assignedTo);

  // Track change details
  let changeMessage = `worked on Goal "${updatedGoal.title}"`;
  if (updates.progress !== undefined && updates.progress !== oldProgress) {
    changeMessage = `updated progress of "${updatedGoal.title}" to ${updates.progress}% (was ${oldProgress}%)`;
  }
  if (updates.status !== undefined && updates.status !== oldStatus) {
    changeMessage = `shifted status of "${updatedGoal.title}" from "${oldStatus}" to "${updates.status}"`;
  }
  if (updates.accountableNotes && updates.accountableNotes !== existingGoal.accountableNotes) {
    changeMessage = `updated notes on "${updatedGoal.title}": "${updates.accountableNotes.substring(0, 45)}${updates.accountableNotes.length > 45 ? "..." : ""}"`;
  }

  const notificationBody = `🔄 GOAL UPDATE: ${performerName} ${changeMessage}. Assigner & Accountable synced.`;

  // Push notifications to ALL THREE involved parties if they are unique
  const notifyUsers = new Set<string>([updatedGoal.assignedTo, updatedGoal.accountable, updatedGoal.assignedBy]);
  
  let count = 0;
  notifyUsers.forEach((userId) => {
    if (userId) {
      db.notifications.unshift({
        id: `not-${Date.now()}-gu-${count++}`,
        userId,
        message: notificationBody,
        type: updatedGoal.status === "Completed" ? "success" : "info",
        readStatus: false,
        createdAt: new Date().toISOString()
      });
    }
  });

  await writeDatabase(db);
  res.json(updatedGoal);
});

app.delete("/api/goals/:id", async (req, res) => {
  const { id } = req.params;
  const db = readDatabase();

  if (!db.goals) db.goals = [];
  const initialLen = db.goals.length;
  db.goals = db.goals.filter((g) => g.id !== id);

  if (db.goals.length === initialLen) {
    return res.status(404).json({ error: "Goal not found" });
  }

  await writeDatabase(db);
  res.json({ success: true });
});

// ==========================================
// Task Timer Play, Pause & Completion APIs
// ==========================================

app.post("/api/tasks/:id/play", async (req, res) => {
  const { id } = req.params;
  const { userId, userName } = req.body;
  const db = readDatabase();

  const taskIndex = db.tasks.findIndex((t) => t.id === id);
  if (taskIndex === -1) {
    return res.status(404).json({ error: "Task not found." });
  }

  const task = db.tasks[taskIndex];
  const previousTask = { ...task };

  // Set timer to running
  task.timerState = "running";
  task.lastStartedAt = new Date().toISOString();

  // Starting or resuming work always moves the task into the active workflow.
  task.status = "In Progress";
  task.stage = "In Progress";
  if (!task.startedAt) {
    task.startedAt = new Date().toISOString();
  }
  task.lastUpdatedDate = new Date().toISOString();

  const message = `⏱️ TIMER STARTED: ${userName || "Team member"} started the timer on "${task.title}" (${task.id}).`;

  // Create real-time notification for task owner/creator
  const notifyTarget = task.assignedBy !== userId ? task.assignedBy : task.assignedTo;
  db.notifications.unshift({
    id: `not-${Date.now()}-timer-play`,
    userId: notifyTarget,
    message,
    type: "info",
    readStatus: false,
    createdAt: new Date().toISOString()
  });

  // Log activity
  db.activityLogs.unshift({
    id: `log-${Date.now()}-timer-play`,
    taskId: task.id,
    userId: userId || "usr-unknown",
    userName: userName || "Team Member",
    action: `Started/Resumed work timer (Status: ${task.status})`,
    timestamp: new Date().toISOString()
  });

  try {
    await persistTaskRow(task);
    void writeDatabase(db);
    res.json(task);
  } catch (error) {
    db.tasks[taskIndex] = previousTask;
    db.notifications.shift();
    db.activityLogs.shift();
    console.error("Task timer start persistence failed:", error);
    res.status(500).json({ error: "Timer start could not be saved. Please try again." });
  }
});

app.post("/api/tasks/:id/pause", async (req, res) => {
  const { id } = req.params;
  const { userId, userName } = req.body;
  const db = readDatabase();

  const taskIndex = db.tasks.findIndex((t) => t.id === id);
  if (taskIndex === -1) {
    return res.status(404).json({ error: "Task not found." });
  }

  const task = db.tasks[taskIndex];
  const previousTask = { ...task };

  if (task.timerState === "running" && task.lastStartedAt) {
    const elapsedMs = Date.now() - new Date(task.lastStartedAt).getTime();
    if (elapsedMs > 0) {
      task.totalActiveMs = (task.totalActiveMs || 0) + elapsedMs;
    }
  }

  task.timerState = "paused";
  task.lastStartedAt = null;
  task.lastUpdatedDate = new Date().toISOString();

  const totalHrs = task.totalActiveMs ? (task.totalActiveMs / (1000 * 60 * 60)).toFixed(2) : "0.00";
  const message = `⏱️ TIMER PAUSED: ${userName || "Team member"} paused the work timer on "${task.title}" (${task.id}). Total tracked: ${totalHrs} hrs.`;

  const notifyTarget = task.assignedBy !== userId ? task.assignedBy : task.assignedTo;
  db.notifications.unshift({
    id: `not-${Date.now()}-timer-pause`,
    userId: notifyTarget,
    message,
    type: "info",
    readStatus: false,
    createdAt: new Date().toISOString()
  });

  // Log activity
  db.activityLogs.unshift({
    id: `log-${Date.now()}-timer-pause`,
    taskId: task.id,
    userId: userId || "usr-unknown",
    userName: userName || "Team Member",
    action: `Paused work timer. Total active session: ${totalHrs} hours.`,
    timestamp: new Date().toISOString()
  });

  try {
    await persistTaskRow(task);
    void writeDatabase(db);
    res.json(task);
  } catch (error) {
    db.tasks[taskIndex] = previousTask;
    db.notifications.shift();
    db.activityLogs.shift();
    console.error("Task timer pause persistence failed:", error);
    res.status(500).json({ error: "Timer pause could not be saved. Please try again." });
  }
});

app.post("/api/tasks/:id/complete", async (req, res) => {
  const { id } = req.params;
  const { userId, userName } = req.body;
  const db = readDatabase();

  const taskIndex = db.tasks.findIndex((t) => t.id === id);
  if (taskIndex === -1) {
    return res.status(404).json({ error: "Task not found." });
  }

  const task = db.tasks[taskIndex];
  const previousTask = { ...task };

  // If timer is running, calculate final elapsed
  if (task.timerState === "running" && task.lastStartedAt) {
    const elapsedMs = Date.now() - new Date(task.lastStartedAt).getTime();
    if (elapsedMs > 0) {
      task.totalActiveMs = (task.totalActiveMs || 0) + elapsedMs;
    }
  }

  task.timerState = "idle";
  task.lastStartedAt = null;
  task.status = "Completed";
  task.stage = "Completed";
  task.completedAt = new Date().toISOString();
  task.lastUpdatedDate = task.completedAt;

  if (task.totalActiveMs) {
    task.actualHoursElapsed = parseFloat((task.totalActiveMs / (1000 * 60 * 60)).toFixed(2));
    task.actualDaysElapsed = parseFloat((task.totalActiveMs / (1000 * 60 * 60 * 24)).toFixed(2));
    task.actualHours = task.actualHoursElapsed;
  } else {
    // Fallback if no timer was ever run, compute from startedAt to completedAt or default to 1 hr
    const startIso = task.startedAt;
    if (startIso) {
      const diffMs = Date.now() - new Date(startIso).getTime();
      task.actualHoursElapsed = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));
      task.actualDaysElapsed = parseFloat((diffMs / (1000 * 60 * 60 * 24)).toFixed(2));
      task.actualHours = task.actualHoursElapsed;
    } else {
      task.actualHoursElapsed = 1;
      task.actualDaysElapsed = 0.04;
      task.actualHours = 1;
    }
  }

  const message = `✅ TASK COMPLETED: ${userName || "Team member"} completed "${task.title}" (${task.id}). Tracked time: ${task.actualHoursElapsed} hrs (${task.actualDaysElapsed} days).`;

  // Notify Assigner/Creator
  db.notifications.unshift({
    id: `not-${Date.now()}-timer-comp`,
    userId: task.assignedBy,
    message,
    type: "success",
    readStatus: false,
    createdAt: new Date().toISOString()
  });
  notifyAdminsOfTaskCompletion(db, task, userName || "Team member", task.assignedBy);

  // Log activity
  db.activityLogs.unshift({
    id: `log-${Date.now()}-timer-comp`,
    taskId: task.id,
    userId: userId || "usr-unknown",
    userName: userName || "Team Member",
    action: `Completed task. Working-time: ${task.actualHoursElapsed} hours, ${task.actualDaysElapsed} days.`,
    timestamp: new Date().toISOString()
  });

  try {
    await persistTaskRow(task);
    void writeDatabase(db);
    res.json(task);
  } catch (error) {
    db.tasks[taskIndex] = previousTask;
    db.notifications.shift();
    db.activityLogs.shift();
    console.error("Task completion persistence failed:", error);
    res.status(500).json({ error: "Task completion could not be saved. Please try again." });
  }
});

// ==========================================
// Attendance & Leave Tracking APIs
// ==========================================

app.get("/api/attendance", (req, res) => {
  const { userId } = req.query;
  const db = readDatabase();
  let records = db.attendances || [];

  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  if (userId) {
    records = records.filter((r) => r.userId === userId);
  }
  res.json(records);
});

function formatIstTime(isoString: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(new Date(isoString));
}

function getAttendanceDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

app.post("/api/attendance/clock-in", async (req, res) => {
  const { userId, userName, type } = req.body;
  const db = readDatabase();

  if (!userId || !type) {
    return res.status(400).json({ error: "User ID and Work From Home attendance type are required." });
  }

  // userId comes from the client's cached session, which can outlive the
  // actual user record (e.g. the account was removed server-side). Catching
  // that here gives a clear "session invalid" signal instead of letting the
  // write fail downstream with an opaque FK/db error.
  if (!db.users.find((u) => u.id === userId)) {
    return res.status(401).json({ error: "Your login session is no longer valid. Please sign in again." });
  }

  if (!db.attendances) db.attendances = [];

  const todayStr = getAttendanceDateKey();

  // Attendance is immutable per person/day: one clock-in and one clock-out.
  const todayRecord = db.attendances.find((r) => r.userId === userId && r.date === todayStr);
  if (todayRecord) {
    return res.status(409).json({
      error: todayRecord.status === "Open"
        ? "You are already clocked in for today."
        : "Today's attendance is already completed. You can clock in again tomorrow."
    });
  }

  const newAttendance = {
    id: `att-${Date.now()}`,
    userId,
    userName: userName || "Team Member",
    date: todayStr,
    type: "WFH" as const,
    status: "Open" as const,
    clockInTime: new Date().toISOString()
  };

  db.attendances.unshift(newAttendance);

  // Verify the attendance row itself is durably stored before reporting success.
  // The full-state sync below also persists notifications, but historically it
  // logged Supabase errors without failing this request.
  if (supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from("attendances")
      .upsert(rowMappers.attendances.toRow(newAttendance), { onConflict: "id" });
    if (error) {
      db.attendances.shift();
      console.error("Attendance clock-in persistence failed:", error.message);
      return res.status(500).json({ error: "Clock-in could not be saved. Please try again." });
    }
  }

  // Notify Admins
  const admins = db.users.filter((u) => u.role === "Admin" || u.role === "Manager");
  admins.forEach((admin) => {
    db.notifications.unshift({
      id: `not-${Date.now()}-clockin-${admin.id}`,
      userId: admin.id,
      message: `📢 ATTENDANCE: ${userName || "Team member"} clocked in from ${type} (${formatIstTime(newAttendance.clockInTime)} IST).`,
      type: "info",
      readStatus: false,
      createdAt: new Date().toISOString()
    });
  });

  await writeDatabase(db);
  res.status(201).json(newAttendance);
});

app.post("/api/attendance/clock-out", async (req, res) => {
  const { userId } = req.body;
  const db = readDatabase();

  if (!userId) {
    return res.status(400).json({ error: "User ID is required." });
  }

  if (!db.users.find((u) => u.id === userId)) {
    return res.status(401).json({ error: "Your login session is no longer valid. Please sign in again." });
  }

  if (!db.attendances) db.attendances = [];

  const todayStr = getAttendanceDateKey();
  // A previous day's unfinished record must never become today's session.
  const openRecordIndex = db.attendances.findIndex((r) => r.userId === userId && r.date === todayStr && r.status === "Open");
  if (openRecordIndex === -1) {
    const todayRecord = db.attendances.find((r) => r.userId === userId && r.date === todayStr);
    return res.status(todayRecord ? 409 : 400).json({
      error: todayRecord
        ? "You have already clocked out today."
        : "No clock-in found for today."
    });
  }

  const record = db.attendances[openRecordIndex];
  const previousClockOutTime = record.clockOutTime;
  record.status = "Closed";
  record.clockOutTime = new Date().toISOString();

  if (supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from("attendances")
      .upsert(rowMappers.attendances.toRow(record), { onConflict: "id" });
    if (error) {
      record.status = "Open";
      record.clockOutTime = previousClockOutTime;
      console.error("Attendance clock-out persistence failed:", error.message);
      return res.status(500).json({ error: "Clock-out could not be saved. Please try again." });
    }
  }

  // Notify Admins
  const admins = db.users.filter((u) => u.role === "Admin" || u.role === "Manager");
  admins.forEach((admin) => {
    db.notifications.unshift({
      id: `not-${Date.now()}-clockout-${admin.id}`,
      userId: admin.id,
      message: `📢 ATTENDANCE: ${record.userName} closed session (clocked out at ${formatIstTime(record.clockOutTime!)} IST).`,
      type: "info",
      readStatus: false,
      createdAt: new Date().toISOString()
    });
  });

  await writeDatabase(db);
  res.json(record);
});

app.get("/api/leaves", (req, res) => {
  const { userId } = req.query;
  const db = readDatabase();
  let leaves = db.leaveRequests || [];

  if (userId) {
    leaves = leaves.filter((l) => l.userId === userId);
  }
  res.json(leaves);
});

app.delete("/api/leaves", async (req, res) => {
  const db = readDatabase();
  db.leaveRequests = [];
  await writeDatabase(db);
  res.json({ success: true });
});

app.post("/api/leaves", async (req, res) => {
  const { userId, userName, startDate, endDate, reason } = req.body;
  const db = readDatabase();

  if (!userId || !startDate || !endDate || !reason) {
    return res.status(400).json({ error: "User ID, Start Date, End Date, and Reason are required." });
  }

  if (!db.leaveRequests) db.leaveRequests = [];

  const newLeave = {
    id: `lv-${Date.now()}`,
    userId,
    userName: userName || "Team Member",
    startDate,
    endDate,
    reason,
    status: "Pending" as const,
    createdAt: new Date().toISOString()
  };

  db.leaveRequests.unshift(newLeave);

  // Notify Admins
  const admins = db.users.filter((u) => u.role === "Admin" || u.role === "Manager");
  admins.forEach((admin) => {
    db.notifications.unshift({
      id: `not-${Date.now()}-leave-req-${admin.id}`,
      userId: admin.id,
      message: `✈️ LEAVE REQUEST: ${userName || "Team member"} requested leave from ${startDate} to ${endDate}. Reason: "${reason.substring(0, 40)}"`,
      type: "warning",
      readStatus: false,
      createdAt: new Date().toISOString()
    });
  });

  await writeDatabase(db);
  res.status(201).json(newLeave);
});

app.post("/api/leaves/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status, adminName } = req.body; // status: "Approved" | "Rejected"
  const db = readDatabase();

  if (!status || (status !== "Approved" && status !== "Rejected")) {
    return res.status(400).json({ error: "Invalid status. Must be 'Approved' or 'Rejected'." });
  }

  if (!db.leaveRequests) db.leaveRequests = [];

  const leaveIndex = db.leaveRequests.findIndex((l) => l.id === id);
  if (leaveIndex === -1) {
    return res.status(404).json({ error: "Leave request not found." });
  }

  const leave = db.leaveRequests[leaveIndex];
  leave.status = status;

  // Notify requesting user
  db.notifications.unshift({
    id: `not-${Date.now()}-leave-decision`,
    userId: leave.userId,
    message: `✈️ LEAVE DECISION: Your leave request from ${leave.startDate} to ${leave.endDate} has been ${status.toUpperCase()} by Admin (${adminName || "Sarah Jenkins"}).`,
    type: status === "Approved" ? "success" : "error",
    readStatus: false,
    createdAt: new Date().toISOString()
  });

  await writeDatabase(db);
  res.json(leave);
});

// ==========================================
// AI-Powered Productivity Features via Gemini
// ==========================================

// Workspace agent: answers from durable operational history loaded from Supabase.
app.post("/api/ai/ask-workspace", async (req, res) => {
  const question = String(req.body?.question || "").trim();
  if (!question) return res.status(400).json({ error: "A question is required." });
  if (question.length > 500) return res.status(400).json({ error: "Question is too long." });

  if (supabaseAdmin) await loadMemoryDbFromSupabase();
  const db = readDatabase();
  const normalizedQuestion = question.toLowerCase();
  const mentionedUser = db.users
    .filter((user) => normalizedQuestion.includes(user.name.toLowerCase()) || normalizedQuestion.includes(user.email.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  const userId = mentionedUser?.id;
  const relevantTasks = userId
    ? db.tasks.filter((task) => task.assignedTo === userId || task.assignedBy === userId)
    : db.tasks;
  const relevantTaskIds = new Set(relevantTasks.map((task) => task.id));
  const relevantComments = db.comments
    .filter((comment) => userId ? comment.userId === userId || relevantTaskIds.has(comment.taskId) : true)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 100);
  const relevantActivity = db.activityLogs
    .filter((log) => userId ? log.userId === userId || relevantTaskIds.has(log.taskId) : true)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 150);
  const relevantAttendance = (db.attendances || []).filter((row) => !userId || row.userId === userId).slice(-90);
  const relevantLeaves = (db.leaveRequests || []).filter((row) => !userId || row.userId === userId).slice(-50);
  const relevantGoals = (db.goals || []).filter((goal) => !userId || goal.assignedTo === userId || goal.accountable === userId || goal.assignedBy === userId);

  const workspaceContext = {
    targetUser: mentionedUser ? { id: mentionedUser.id, name: mentionedUser.name, role: mentionedUser.role, department: mentionedUser.department } : null,
    users: db.users.map(({ id, name, role, department }) => ({ id, name, role, department })),
    projects: db.projects,
    tasks: relevantTasks.slice(0, 100),
    comments: relevantComments,
    activity: relevantActivity,
    attendance: relevantAttendance,
    leaves: relevantLeaves,
    goals: relevantGoals.slice(0, 50)
  };

  if (!ai) {
    return res.json({
      answer: `${mentionedUser?.name || "The workspace"} has ${relevantTasks.filter((task) => task.status !== "Completed").length} active task(s), ${relevantTasks.filter((task) => task.status === "Completed").length} completed task(s), ${relevantActivity.length} recent activity record(s), and ${relevantComments.length} relevant comment(s). Configure GEMINI_API_KEY for a detailed natural-language answer.`,
      targetUser: mentionedUser?.name || null,
      sources: { tasks: relevantTasks.length, comments: relevantComments.length, activity: relevantActivity.length }
    });
  }

  try {
    const prompt = `You are a secure operations analyst for a legal practice. Answer the user's question using only the supplied workspace records. Never invent facts. Mention dates and task names when helpful. If records do not support the answer, say so clearly. Keep the answer concise and professional.\n\nQuestion: ${question}\n\nWorkspace records:\n${JSON.stringify(workspaceContext)}`;
    const geminiRes = await ai.models.generateContent({ model: "gemini-3.6-flash", contents: prompt });
    res.json({
      answer: geminiRes.text?.trim() || "No supported answer could be generated from the available records.",
      targetUser: mentionedUser?.name || null,
      sources: { tasks: relevantTasks.length, comments: relevantComments.length, activity: relevantActivity.length }
    });
  } catch (error) {
    console.error("Workspace agent query failed:", error);
    res.status(500).json({ error: "Workspace history could not be analyzed right now." });
  }
});

// Endpoint 1: AI Task Summary & Risk Prediction
app.post("/api/ai/analyze-task", async (req, res) => {
  const { taskId } = req.body;
  const db = readDatabase();

  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) {
    return res.status(404).json({ error: "Task not found for analysis" });
  }

  // Construct prompt focused on legal workflows
  const prompt = `
Analyze the following legal case matter action item and provide professional senior partner insights.
Task ID: ${task.id}
Title: ${task.title}
Description: ${task.description}
Priority: ${task.priority}
Status: ${task.status}
Stage: ${task.stage}
Due Date: ${task.dueDate}
Estimated Hours: ${task.estimatedHours}
Actual Hours: ${task.actualHours}
Is Billable: ${task.isBillable ? "Yes" : "No"}
Hourly Billing Rate: $${task.hourlyRate || 250}/hr
Client Approval Status: ${task.clientApprovalStatus || "Not Required"}
Matter Code: ${task.matterCode || "N/A"}
Current System Time: 2026-06-17T21:52:12-07:00 (Today)

Based on this:
1. Provide a concise, highly professional case task objective summary of single sentence.
2. Suggest the absolute best priority recommendation (Keep as is, upgrade to Critical, downgrade, etc.) and give a brief legal-practice reasoning.
3. Assess the "deadline risk" ("Low", "Medium", or "High") and specify docket court-filing hazard factors (overdue status, complexity, client approval latency).
4. Provide a customized smart billing or partner reminder recommendation to get this done fast.

Respond in strict JSON with the following structure:
{
  "taskId": "${task.id}",
  "summary": "Brief task objective summary",
  "prioritySuggestion": "Critical | High | Medium | Low",
  "priorityReason": "Explain priority match",
  "deadlineRisk": "Low | Medium | High",
  "deadlineRiskReason": "Detail timeline risk context",
  "smartReminder": "Actionable micro-copy notification text"
}
`;

  if (!ai) {
    // Fallback if no Gemini Key available
    const today = new Date("2026-06-17T21:52:12-07:00");
    const dueDate = new Date(task.dueDate);
    const hoursLeft = task.estimatedHours - task.actualHours;
    const isOverdue = dueDate.getTime() < today.getTime() && task.status !== "Completed";
    const risk = isOverdue ? "High" : hoursLeft > 8 ? "Medium" : "Low";

    return res.json({
      taskId: task.id,
      summary: `Execute objectives for "${task.title}" focusing on key deliverables.`,
      prioritySuggestion: task.priority,
      priorityReason: "Defaulting to initial structural parameters.",
      deadlineRisk: risk,
      deadlineRiskReason: isOverdue ? "Task due date has passed with code modifications pending." : "Work hours match timeline constraints.",
      smartReminder: `⚠️ Alert: High-priority focus required on "${task.title}" to avoid timeline slippage.`
    });
  }

  try {
    const geminiRes = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(geminiRes.text?.trim() || "{}");
    res.json(parsed);
  } catch (error) {
    console.error("Gemini Task Analysis failed:", error);
    res.status(500).json({ error: "AI reasoning failed to compile." });
  }
});

// Endpoint 2: Workload Balancing suggestions
app.post("/api/ai/workload-balancing", async (req, res) => {
  const db = readDatabase();

  const userTasksMap = db.users.map((u) => {
    const assignedTasks = db.tasks.filter((t) => t.assignedTo === u.id && t.status !== "Completed");
    const totalEstimated = assignedTasks.reduce((acc, t) => acc + t.estimatedHours, 0);
    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      activeTasksCount: assignedTasks.length,
      uncompletedHours: totalEstimated,
      tasks: assignedTasks.map((t) => ({ id: t.id, title: t.title, score: t.priority }))
    };
  });

  const prompt = `
Evaluate the current legal firm caseload and lawyer/paralegal allocation metrics to optimize attorney performance, avoid burnout, and balance court-filing deliverables:
Caseload and hour-backlogs:
${JSON.stringify(userTasksMap, null, 2)}

Provide balancing suggestions. Keep recommendations focused on litigation workflows, legal filing pressure, and smart task delegations.
Respond in strict JSON with the following schema:
{
  "summary": "Team performance and balance evaluation.",
  "suggestions": [
     "Specific case item delegation recommendation from over-allocated attorneys to paralegals or available junior associates.",
     "Identify crucial legal drafting bottleneck threats."
  ],
  "bestBalancedAssignee": "Name of recommended attorney or paralegal with lowest capacity backlog."
}
`;

  if (!ai) {
    return res.json({
      summary: "Workload distribution is within tolerable margins. Liam Carter and Sophia Chen currently have optimal spare hours.",
      suggestions: [
        "Reallocate test validations for outstanding tasks to Liam Carter (QA lead) to alleviate development congestion.",
        "Consider shifting low-priority UI designs back to Sophia Chen while Tushar focuses on core authentication components."
      ],
      bestBalancedAssignee: "Liam Carter"
    });
  }

  try {
    const geminiRes = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });
    const parsed = JSON.parse(geminiRes.text?.trim() || "{}");
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: "AI Balancing Engine failed." });
  }
});

// Endpoint 3: AI Daily Progress Summary
app.post("/api/ai/daily-summary", async (req, res) => {
  const db = readDatabase();

  const completed = db.tasks.filter((t) => t.status === "Completed").length;
  const inProgress = db.tasks.filter((t) => t.status === "In Progress").length;
  const overdueCount = db.tasks.filter((t) => {
    if (t.status === "Completed") return false;
    return new Date(t.dueDate).getTime() < new Date("2026-06-17").getTime();
  }).length;

  const total = db.tasks.length;

  const prompt = `
Generate a professional, motivating Law Firm Docket & Case Daily Progress Summary representing the firm's active matter progress.
Metrics:
- Total matter assignments tracked: ${total}
- Drafted & Filed litigation items: ${completed}
- Under preparation or active document drafting: ${inProgress}
- Urgent court schedule docket warnings (overdue): ${overdueCount}

Write a 2-sentence positive performance assessment summary focusing on caseload accountability, list top 3 docket-filing and client consultation priority points, and add a motivating legal practitioner quote.
Respond in strict JSON with this structure:
{
  "overviewText": "Positive dynamic summary",
  "focusPoints": ["Operation A priority", "Operation B check-in", "Blockers review"],
  "motivatingQuote": "Inspiring business quote"
}
`;

  if (!ai) {
    return res.json({
      overviewText: "The team has successfully deployed 2 core milestones this week, with development on Orion Integration continuing at a high pace.",
      focusPoints: [
        "Unblock deployment bottlenecks on the Quantum Analytics suite due to DNS propagation.",
        "Execute automated reminder E2E testing with QA lead Liam Carter.",
        "Refine OAuth routing handlers for production staging."
      ],
      motivatingQuote: "Operational excellence is not an act, but a habit of disciplined tracking."
    });
  }

  try {
    const geminiRes = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const parsed = JSON.parse(geminiRes.text?.trim() || "{}");
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: "Daily Summary Generator failed." });
  }
});

// Catch-all: any route handler that throws (sync or via next(err)) lands here.
// Without this, Express's default error page is HTML, which breaks every
// frontend `res.json()` call expecting a JSON error body.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled API error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error." });
});

// Integrate Vite Middleware for Client Application Access
async function startServer() {
  await ensureInitialized();

  if (process.env.NODE_ENV !== "production") {
    // Development mode. Imported lazily (not at module top-level) so the
    // vite dev-server toolchain is never pulled into the Vercel serverless
    // function bundle, where it has no reason to run and can fail to load.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    // Production mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Bind to port 3000 and 0.0.0.0 for container accessibility
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Team Management Core Server boot active on port ${PORT}`);
  });
}

// Vercel invokes this module as a serverless function per request (see api/index.ts)
// instead of calling listen() on a persistent port, so the traditional boot
// sequence (static file serving, vite dev middleware, app.listen) only runs
// on hosts that actually own a long-lived process (Render, Railway, local dev).
export default app;

if (!process.env.VERCEL) {
  startServer();
}
