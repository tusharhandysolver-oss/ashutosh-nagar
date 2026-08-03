/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { Task, User, Comment, ActivityLog, TaskPriority, TaskStatus, TaskStage } from "../types";
import { X, MessageSquare, Calendar, Clock, Send, ShieldAlert, Sparkles, AlertTriangle, RefreshCw, BarChart2, CheckSquare, Play, Pause, Check, Lock, Layers, Flag, UserCircle2, ChevronRight, Activity, Users, CheckCheck } from "lucide-react";

interface TaskModalProps {
  task: Task;
  currentUser: User;
  users: User[];
  onClose: () => void;
  onUpdate: (updatedTask: Partial<Task> & { editorId?: string; editorName?: string }) => void;
}

function getPriorityBadgeClass(p: string) {
  switch (p) {
    case "Critical":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "High":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "Medium":
      return "bg-sky-50 text-sky-700 border-sky-200";
    default:
      return "bg-slate-50 text-slate-650 border-slate-200";
  }
}

export default function TaskModal({ task, currentUser, users, onClose, onUpdate }: TaskModalProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiReport, setAiReport] = useState<{
    summary?: string;
    prioritySuggestion?: string;
    priorityReason?: string;
    deadlineRisk?: "Low" | "Medium" | "High";
    deadlineRiskReason?: string;
    smartReminder?: string;
  } | null>(null);

  // Form edit states (managers/admins can update full fields, members can update status/hours)
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority || "Medium");
  const [status, setStatus] = useState<TaskStatus>(task?.status || "Not Started");
  const [stage, setStage] = useState<TaskStage>(task?.stage || "In Progress");
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo || "");
  const [dueDate, setDueDate] = useState(task?.dueDate ? (task.dueDate.includes("T") ? task.dueDate.split("T")[0] : task.dueDate) : "");
  const [isBillable, setIsBillable] = useState(task?.isBillable !== false);
  const [hourlyRate, setHourlyRate] = useState(task?.hourlyRate || 250);
  const [clientApprovalStatus, setClientApprovalStatus] = useState(task?.clientApprovalStatus || "Not Required");
  const [matterCode, setMatterCode] = useState(task?.matterCode || "");

  const isManagerOrAdmin = currentUser?.role === "Admin" || currentUser?.role === "Manager";
  const canTrackProgress = task?.assignedTo === currentUser?.id;
  const canUpdateTaskDetails = task?.assignedBy === currentUser?.id || currentUser?.role === "Admin";

  const [timerLoading, setTimerLoading] = useState(false);
  const conversationEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title || "");
    setDescription(task.description || "");
    setPriority(task.priority || "Medium");
    setStatus(task.status || "Not Started");
    setStage(task.stage || "In Progress");
    setAssignedTo(task.assignedTo || "");
    setDueDate(task.dueDate ? (task.dueDate.includes("T") ? task.dueDate.split("T")[0] : task.dueDate) : "");
    setIsBillable(task.isBillable !== false);
    setHourlyRate(task.hourlyRate || 250);
    setClientApprovalStatus(task.clientApprovalStatus || "Not Required");
    setMatterCode(task.matterCode || "");
  }, [task]);

  async function handlePlayTimer() {
    setTimerLoading(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/play`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser.id, userName: currentUser.name })
      });
      if (res.ok) {
        const updatedTask = await res.json();
        onUpdate(updatedTask);
        fetchCommentsAndLogs();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTimerLoading(false);
    }
  }

  async function handlePauseTimer() {
    setTimerLoading(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser.id, userName: currentUser.name })
      });
      if (res.ok) {
        const updatedTask = await res.json();
        onUpdate(updatedTask);
        fetchCommentsAndLogs();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTimerLoading(false);
    }
  }

  async function handleCompleteTimer() {
    setTimerLoading(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser.id, userName: currentUser.name })
      });
      if (res.ok) {
        const updatedTask = await res.json();
        onUpdate(updatedTask);
        fetchCommentsAndLogs();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTimerLoading(false);
    }
  }

  useEffect(() => {
    fetchCommentsAndLogs();
  }, [task.id]);

  useEffect(() => {
    if (!loadingComments) conversationEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [comments.length, loadingComments]);

  async function fetchCommentsAndLogs() {
    setLoadingComments(true);
    try {
      const [commentsRes, logsRes] = await Promise.all([
        fetch(`/api/tasks/${task.id}/comments`),
        fetch(`/api/tasks/${task.id}/activity`)
      ]);
      if (commentsRes.ok) {
        const cData = await commentsRes.json();
        setComments(cData);
      }
      if (logsRes.ok) {
        const lData = await logsRes.json();
        setActivityLogs(lData);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingComments(false);
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;

    try {
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comment: newComment,
          userId: currentUser.id,
          userName: currentUser.name
        })
      });

      if (res.ok) {
        setNewComment("");
        fetchCommentsAndLogs();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleTriggerAI() {
    setLoadingAI(true);
    try {
      const res = await fetch("/api/ai/analyze-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id })
      });
      if (res.ok) {
        const data = await res.json();
        setAiReport(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingAI(false);
    }
  }

  function handleSaveTask() {
    const updatedFields: Partial<Task> & { editorId?: string; editorName?: string } = {
      status,
      stage,
      editorId: currentUser.id,
      editorName: currentUser.name,
      isBillable,
      hourlyRate: Number(hourlyRate),
      clientApprovalStatus,
      matterCode
    };

    if (canUpdateTaskDetails) {
      updatedFields.title = title;
      updatedFields.description = description;
      updatedFields.priority = priority;
      updatedFields.assignedTo = assignedTo;
      updatedFields.dueDate = `${dueDate}T18:00:00Z`;
    }

    onUpdate(updatedFields);
  }

  // Find users
  const assignedUser = users.find(u => u.id === task.assignedTo);
  const authorUser = users.find(u => u.id === task.assignedBy);

  return (
    <div id="task-modal-bg" className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-2 sm:p-4 backdrop-blur-md overflow-y-auto animate-fade-in">
      <div id="task-modal-card" role="dialog" aria-modal="true" aria-labelledby="task-modal-title" className="relative w-full max-w-6xl rounded-2xl sm:rounded-[32px] bg-white border border-white/80 text-slate-800 shadow-[0_32px_100px_-24px_rgba(15,23,42,0.45)] flex flex-col max-h-[96vh] sm:max-h-[92vh] overflow-hidden animate-modal-in">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-150/80 px-4 sm:px-8 py-4 sm:py-5 bg-white/80 backdrop-blur-xl sticky top-0 z-10 gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="rounded-full bg-gradient-to-br from-amber-100 to-orange-200 px-3.5 py-1.5 text-xs font-black text-orange-800 font-mono tracking-wider">
              {task.id}
            </span>
            <h2 id="task-modal-title" className="text-base sm:text-lg font-black text-slate-900 tracking-tight truncate">{canUpdateTaskDetails ? "Edit Task" : "Task Details"}</h2>
          </div>
          <button
            id="close-modal-btn"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="rounded-full h-9 w-9 flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-all cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 p-4 sm:p-6 lg:p-8 overflow-y-auto flex-1 min-w-0 bg-gradient-to-br from-white via-white to-slate-50/70">

          {/* Left Column: Form / Info */}
          <div className="lg:col-span-7 space-y-5">
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-500">Title</label>
              {canUpdateTaskDetails ? (
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1.5 w-full rounded-xl bg-white border border-slate-200 px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-slate-400 focus:ring-3 focus:ring-slate-100 focus:outline-hidden text-base font-semibold transition-all"
                />
              ) : (
                <div className="mt-1.5 text-xl font-extrabold text-slate-900 tracking-tight">{task.title}</div>
              )}
            </div>

            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-500">Description</label>
              {canUpdateTaskDetails ? (
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="mt-1.5 w-full rounded-xl bg-white border border-slate-200 px-4 py-3 text-slate-700 placeholder-slate-400 focus:border-slate-400 focus:ring-3 focus:ring-slate-100 focus:outline-hidden text-sm leading-relaxed resize-none transition-all"
                />
              ) : (
                <p className="mt-1.5 text-sm text-slate-700 leading-relaxed bg-slate-50 p-5 rounded-xl border border-slate-200">
                  {task.description || "No description provided."}
                </p>
              )}
            </div>

            {/* Config: iOS-style grouped inset list */}
            <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-[0_8px_30px_-24px_rgba(15,23,42,0.35)]">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3 shrink-0">
                  <span className="h-7 w-7 rounded-lg bg-blue-500 flex items-center justify-center text-white shrink-0">
                    <Layers className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-1">
                    Stage {!canTrackProgress && <Lock className="h-3 w-3 text-slate-400" />}
                  </span>
                </div>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value as TaskStage)}
                  disabled={!canTrackProgress}
                  className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-hidden cursor-pointer hover:border-slate-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="Case Intake">Case Intake</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3 shrink-0">
                  <span className="h-7 w-7 rounded-lg bg-rose-500 flex items-center justify-center text-white shrink-0">
                    <Flag className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-semibold text-slate-700">Priority</span>
                </div>
                {canUpdateTaskDetails ? (
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-semibold focus:border-blue-500 cursor-pointer ${getPriorityBadgeClass(priority)}`}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                ) : (
                  <div className={`rounded-full border px-3 py-1 text-xs font-bold ${getPriorityBadgeClass(task.priority)}`}>
                    {task.priority}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3 shrink-0">
                  <span className="h-7 w-7 rounded-lg bg-emerald-500 flex items-center justify-center text-white shrink-0">
                    <Calendar className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-semibold text-slate-700">Due Date</span>
                </div>
                {canUpdateTaskDetails ? (
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-800 focus:border-blue-500"
                  />
                ) : (
                  <span className="text-sm font-bold text-slate-800">
                    {task?.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date"}
                  </span>
                )}
              </div>
            </div>

            {/* Work Timer Control Center */}
            <div className="bg-slate-950 text-white rounded-2xl p-4 border border-slate-900 space-y-3 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.8)]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-amber-300 tracking-wider flex items-center gap-1.5 font-display">
                  <Clock className="h-4 w-4 text-amber-400 shrink-0 animate-pulse" />
                  Timer
                </span>
                <span className={`px-2 py-0.5 rounded-lg text-xs font-black uppercase border font-mono ${
                  task.timerState === "running" ? "bg-emerald-500 text-white border-emerald-400 animate-pulse" :
                  task.timerState === "paused" ? "bg-amber-500 text-white border-amber-400" :
                  "bg-slate-800 text-slate-400 border-slate-700"
                }`}>
                  {task.timerState === "running" ? "● Running" : task.timerState === "paused" ? "⏸️ Paused" : "Idle"}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white/5 p-3 rounded-xl border border-white/10">
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Elapsed</span>
                  <div className="text-xl font-black font-mono text-amber-300">
                    {task.totalActiveMs ? (task.totalActiveMs / (1000 * 60 * 60)).toFixed(2) : "0.00"} <span className="text-xs text-slate-400 font-medium">hrs</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  {!canTrackProgress ? (
                    <div className="text-[11px] font-semibold text-slate-400 px-2 py-1 flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5 text-amber-400" />
                      <span>Assignee only</span>
                    </div>
                  ) : task.status !== "Completed" ? (
                    <>
                      {task.timerState === "running" ? (
                        <button
                          type="button"
                          onClick={handlePauseTimer}
                          disabled={timerLoading}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 hover:shadow-lg hover:-translate-y-0.5 font-bold text-xs rounded-xl text-white transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                        >
                          <Pause className="h-3.5 w-3.5" /> Pause
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handlePlayTimer}
                          disabled={timerLoading}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 hover:shadow-lg hover:-translate-y-0.5 font-bold text-xs rounded-xl text-white transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                        >
                          <Play className="h-3.5 w-3.5" /> {task.timerState === "paused" ? "Resume" : "Start"}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={handleCompleteTimer}
                        disabled={timerLoading}
                        className="px-3 py-1.5 bg-gradient-to-r from-blue-700 to-cyan-600 hover:from-blue-800 hover:to-cyan-700 hover:shadow-lg hover:-translate-y-0.5 font-bold text-xs rounded-xl text-white transition-all active:scale-95 flex items-center gap-1 cursor-pointer disabled:opacity-70 disabled:cursor-wait"
                      >
                        {timerLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        {timerLoading ? "Completing…" : "Complete"}
                      </button>
                    </>
                  ) : (
                    <div className="text-xs font-bold text-emerald-400 flex items-center gap-1 bg-emerald-950/50 border border-emerald-900/60 px-3 py-1.5 rounded-xl">
                      <CheckSquare className="h-4 w-4 text-emerald-400" /> Completed
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Detailed timing analytics are intentionally kept out of this focused modal. */}
            {false && <div className="bg-slate-50 rounded-3xl p-6 border border-slate-200/80 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-slate-600 tracking-wider block flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-blue-900" /> Time Tracking
                </span>
                <span className="text-xs font-bold text-blue-900 px-1.5 py-0.5 bg-amber-50 rounded-lg border border-amber-200">
                  Live
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-xs uppercase font-bold text-slate-500 tracking-wider block">Started</span>
                  <div className="text-xs text-slate-700 font-mono bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5 text-blue-800" />
                    {task.startedAt ? (
                      <span className="truncate" title={new Date(task.startedAt).toLocaleString()}>{new Date(task.startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    ) : (
                      <span className="text-slate-400 italic">Not started yet</span>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-xs uppercase font-bold text-slate-500 tracking-wider block">Completed</span>
                  <div className="text-xs text-slate-700 font-mono bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 flex items-center gap-1">
                    <CheckSquare className="h-3.5 w-3.5 text-emerald-500" />
                    {task.completedAt ? (
                      <span className="truncate" title={new Date(task.completedAt).toLocaleString()}>{new Date(task.completedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    ) : task.status === "In Progress" ? (
                      <span className="text-blue-900 font-bold animate-pulse">In Progress</span>
                    ) : (
                      <span className="text-slate-400 italic">Not yet</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Show metrics if they exist or if the task is completed */}
              {(task.actualHoursElapsed !== undefined || task.actualDaysElapsed !== undefined || task.status === "Completed") && (
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                  <span className="text-xs uppercase font-black text-slate-400 tracking-wider block">Cycle Duration</span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                      <span className="text-xs text-slate-500 block">Days Elapsed</span>
                      <span className="text-xs font-black text-slate-800 font-mono">
                        {task.actualDaysElapsed !== undefined && task.actualDaysElapsed !== null ? `${task.actualDaysElapsed} Days` : "Calculating..."}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                      <span className="text-xs text-slate-500 block">Hours Elapsed</span>
                      <span className="text-xs font-black text-slate-800 font-mono">
                        {task.actualHoursElapsed !== undefined && task.actualHoursElapsed !== null ? `${task.actualHoursElapsed} Hours` : "Calculating..."}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>}



            {/* Assignee / Creator Roles: iOS-style grouped inset list */}
            <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3 shrink-0">
                  <span className="h-7 w-7 rounded-lg bg-violet-500 flex items-center justify-center text-white shrink-0">
                    <UserCircle2 className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-semibold text-slate-700">Assignee</span>
                </div>
                {canUpdateTaskDetails ? (
                  <select
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-800 focus:border-blue-500 hover:border-slate-300 transition-colors cursor-pointer"
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex items-center gap-2">
                    <img
                      src={assignedUser?.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=60"}
                      alt={assignedUser?.name}
                      referrerPolicy="no-referrer"
                      className="h-6 w-6 rounded-full object-cover border border-slate-200"
                    />
                    <span className="text-sm text-slate-800 font-bold">{assignedUser?.name || "Unassigned"}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3 shrink-0">
                  <span className="h-7 w-7 rounded-lg bg-slate-400 flex items-center justify-center text-white shrink-0">
                    <UserCircle2 className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-semibold text-slate-700">Assigned By</span>
                </div>
                <span className="text-sm text-slate-800 font-bold">{authorUser?.name || "Partner"}</span>
              </div>
            </div>

            {/* Actions Panel */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleSaveTask}
                className="flex-1 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 hover:shadow-lg transition-all active:scale-98 shadow-sm cursor-pointer"
              >
                Save Changes
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>

          {/* Right Column: Case Collaboration */}
          <div className="lg:col-span-5 border-t lg:border-t-0 lg:border-l border-slate-200/70 pt-6 lg:pt-0 lg:pl-8 flex flex-col min-w-0">

            {/* Comments & Conversation Section */}
            <div className="flex-1 flex flex-col min-h-[540px] lg:sticky lg:top-0 border border-slate-200/80 rounded-[28px] bg-white overflow-hidden shadow-[0_18px_50px_-28px_rgba(15,23,42,0.35)]">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl px-5 py-4.5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-10 w-10 rounded-2xl bg-slate-950 text-white flex items-center justify-center shadow-sm">
                    <MessageSquare className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-extrabold text-sm text-slate-900 tracking-tight">Comments & Activity</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5"><Users className="h-3 w-3" /> Task conversation</p>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-slate-400">{comments.length} comments</span>
              </div>

              {/* Message List */}
              <div className="flex-1 px-4 sm:px-5 py-5 space-y-5 overflow-y-auto min-h-0 max-h-[520px] bg-[radial-gradient(circle_at_top_right,rgba(219,234,254,0.55),transparent_36%),linear-gradient(to_bottom,#f8fafc,#ffffff)]">
                {loadingComments ? (
                  <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-12"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading conversation...</div>
                ) : (
                  <>
                    {comments.map((com) => {
                      const isMe = com.userId === currentUser.id;
                      return (
                        <div key={com.id} className={`flex items-end gap-2.5 ${isMe ? "flex-row-reverse" : ""}`}>
                          <img
                            src={com.userAvatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=60"}
                            alt={com.userName}
                            referrerPolicy="no-referrer"
                            className="h-8 w-8 rounded-full object-cover ring-2 ring-white shadow-sm shrink-0"
                          />
                          <div className={`max-w-[78%] ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                            <div className="flex items-center gap-2 px-1 mb-1.5">
                              {!isMe && <span className="text-[11px] font-extrabold text-slate-700">{com.userName}</span>}
                              <span className="text-[10px] text-slate-400">{new Date(com.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                            <p className={`px-4 py-2.5 text-[13px] leading-relaxed shadow-sm ${
                              isMe
                                ? "bg-slate-950 text-white rounded-[18px] rounded-br-[5px]"
                                : "bg-white text-slate-700 border border-slate-200/90 rounded-[18px] rounded-bl-[5px]"
                            }`}>
                              {com.comment}
                            </p>
                            {isMe && <span className="flex items-center gap-1 text-[9px] text-slate-400 mt-1.5 mr-1"><CheckCheck className="h-3 w-3 text-blue-500" /> Sent</span>}
                          </div>
                        </div>
                      );
                    })}
                    {comments.length === 0 && (
                      <div className="text-center py-8">
                        <span className="mx-auto mb-3 h-11 w-11 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 shadow-sm"><MessageSquare className="h-5 w-5" /></span>
                        <p className="text-xs font-bold text-slate-600">Start the conversation</p>
                        <p className="text-[11px] text-slate-400 mt-1">Share an update or ask a question.</p>
                      </div>
                    )}

                    <div className="pt-2">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="h-px flex-1 bg-slate-200/80" />
                        <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-slate-400">Recent activity</span>
                        <span className="h-px flex-1 bg-slate-200/80" />
                      </div>
                      <div className="space-y-2.5">
                        {activityLogs.slice(0, 3).map((log) => (
                          <div key={log.id} className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-3">
                            <span className="mt-0.5 h-7 w-7 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0"><Activity className="h-3.5 w-3.5" /></span>
                            <div className="min-w-0">
                              <p className="text-[11px] leading-relaxed text-slate-600"><span className="font-extrabold text-slate-800">{log.userName}</span> {log.action}</p>
                              <p className="text-[10px] text-slate-400 mt-1">{new Date(log.timestamp).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                            </div>
                          </div>
                        ))}
                        {activityLogs.length === 0 && <p className="text-center text-[11px] text-slate-400 py-2">No recent activity</p>}
                      </div>
                    </div>
                    <div ref={conversationEndRef} />
                  </>
                )}
              </div>

              {/* Comment Input */}
              <form onSubmit={handleAddComment} className="border-t border-slate-200/70 p-3.5 bg-white">
                <div className="flex items-end gap-2 rounded-[20px] border border-slate-200 bg-slate-50 p-1.5 pl-4 focus-within:border-slate-400 focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(148,163,184,0.12)] transition-all">
                <textarea
                  rows={1}
                  placeholder="Write a comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
                  className="flex-1 max-h-24 resize-none bg-transparent py-2 text-sm leading-5 text-slate-800 placeholder-slate-400 focus:outline-hidden"
                />
                <button
                  type="submit"
                  disabled={!newComment.trim()}
                  aria-label="Send comment"
                  className="h-10 w-10 rounded-2xl bg-slate-950 text-white hover:bg-blue-700 hover:shadow-lg active:scale-95 transition-all flex items-center justify-center cursor-pointer shadow-sm shrink-0 disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  <Send className="h-4 w-4" />
                </button>
                </div>
                <p className="px-2 pt-2 text-[9px] text-slate-400">Press Enter to send · Shift + Enter for a new line</p>
              </form>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
