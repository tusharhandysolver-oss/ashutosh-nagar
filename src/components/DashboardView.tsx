/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Task, User, TaskStage, TaskPriority, Attendance, LeaveRequest } from "../types";
import { CheckCircle, AlertCircle, Clock, ShieldAlert, BarChart3, UserCheck, Calendar, Eye, PieChart, TrendingUp, Users, Play, Pause, Check } from "lucide-react";

const localDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const cardEntrance = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }
  })
};

interface DashboardViewProps {
  tasks: Task[];
  users: User[];
  currentUser: User;
  onSelectTask: (task: Task) => void;
  onPlayTask?: (task: Task) => void;
  onPauseTask?: (task: Task) => void;
  leaveRequests?: LeaveRequest[];
  onUpdateLeaveStatus?: (leaveId: string, status: "Approved" | "Rejected") => void;
  onCelebrate?: (title: string, message: string) => void;
}

export default function DashboardView({
  tasks,
  users,
  currentUser,
  onSelectTask,
  onPlayTask,
  onPauseTask,
  leaveRequests,
  onUpdateLeaveStatus,
  onCelebrate
}: DashboardViewProps) {
  const isManagerOrAdmin = currentUser.role === "Admin" || currentUser.role === "Manager";

  const [todayAttendance, setTodayAttendance] = useState<Attendance | null>(null);
  const [allAttendances, setAllAttendances] = useState<Attendance[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(true);
  const [attendanceError, setAttendanceError] = useState("");
  
  // Leave form
  const todayStr = () => localDateKey();
  const leaveReasonOptions = [
    { emoji: "🤒", label: "Not feeling well" },
    { emoji: "✈️", label: "Travel" },
    { emoji: "🏠", label: "Family" },
    { emoji: "📝", label: "Personal work" },
    { emoji: "🎉", label: "Occasion" },
    { emoji: "💍", label: "Wedding" }
  ];
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveStart, setLeaveStart] = useState(todayStr());
  const [leaveEnd, setLeaveEnd] = useState(todayStr());
  const [leaveReasonChip, setLeaveReasonChip] = useState("");
  const [leaveNote, setLeaveNote] = useState("");
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveSuccess, setLeaveSuccess] = useState("");

  // WFH/WFO check-in helper
  const [checkingIn, setCheckingIn] = useState(false);

  // Minimalist Presence modal & clock states
  const [showPresenceModal, setShowPresenceModal] = useState(false);
  const [presenceModalStep, setPresenceModalStep] = useState<"options" | "leave">("options");
  const [currentDateTime, setCurrentDateTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchAttendanceAndLeaves();
    const refresh = setInterval(fetchAttendanceAndLeaves, 15000);
    const syncOnFocus = () => fetchAttendanceAndLeaves();
    window.addEventListener("focus", syncOnFocus);
    return () => {
      clearInterval(refresh);
      window.removeEventListener("focus", syncOnFocus);
    };
  }, [currentUser.id]);

  async function fetchAttendanceAndLeaves() {
    setLoadingAttendance(true);
    try {
      const [attRes, allAttRes] = await Promise.all([
        fetch(`/api/attendance?userId=${currentUser.id}&_=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/attendance?_=${Date.now()}`, { cache: "no-store" })
      ]);

      if (attRes.ok) {
        const attData: Attendance[] = await attRes.json();
        const todayStr = localDateKey();
        // Only today's record belongs in today's greeting and controls.
        const active = attData.find(r => r.date === todayStr);
        setTodayAttendance(active || null);
      }

      if (allAttRes.ok) {
        const allAttData: Attendance[] = await allAttRes.json();
        setAllAttendances(allAttData);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingAttendance(false);
    }
  }

  async function handleClockIn(type: "WFH" | "WFO") {
    setCheckingIn(true);
    setAttendanceError("");
    try {
      const res = await fetch("/api/attendance/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUser.id,
          userName: currentUser.name,
          type
        })
      });
      if (res.ok) {
        const data = await res.json();
        setTodayAttendance(data);
        fetchAttendanceAndLeaves();
      } else {
        const err = await res.json();
        setAttendanceError(err.error || "Failed to mark attendance.");
      }
    } catch (e) {
      setAttendanceError("Server unreachable.");
    } finally {
      setCheckingIn(false);
    }
  }

  async function handleClockOut() {
    setCheckingIn(true);
    setAttendanceError("");
    try {
      const res = await fetch("/api/attendance/clock-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser.id })
      });
      if (res.ok) {
        const data = await res.json();
        setTodayAttendance(data);
        fetchAttendanceAndLeaves();
        onCelebrate?.("Day complete!", "You have successfully clocked out. Great work today.");
      } else {
        const err = await res.json();
        setAttendanceError(err.error || "Failed to clock out.");
      }
    } catch (e) {
      setAttendanceError("Server unreachable.");
    } finally {
      setCheckingIn(false);
    }
  }

  async function handleSubmitLeave(e: React.FormEvent) {
    e.preventDefault();
    const reason = leaveReasonChip + (leaveNote.trim() ? ` - ${leaveNote.trim()}` : "");
    if (!leaveStart || !leaveEnd || !leaveReasonChip) return;

    setLeaveSubmitting(true);
    setLeaveSuccess("");
    setAttendanceError("");
    try {
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUser.id,
          userName: currentUser.name,
          startDate: leaveStart,
          endDate: leaveEnd,
          reason
        })
      });

      if (res.ok) {
        setLeaveSuccess("Leave request submitted.");
        setLeaveStart(todayStr());
        setLeaveEnd(todayStr());
        setLeaveReasonChip("");
        setLeaveNote("");
        fetchAttendanceAndLeaves();
      } else {
        const err = await res.json();
        setAttendanceError(err.error || "Failed to submit leave request.");
      }
    } catch (err) {
      setAttendanceError("Server unreachable.");
    } finally {
      setLeaveSubmitting(false);
    }
  }

  // Filter Tasks
  const myTasks = tasks.filter(t => t.assignedTo === currentUser.id);
  const myPendingTasks = myTasks.filter(t => t.status !== "Completed");
  const myInProgressTasks = myTasks.filter(t => t.status === "In Progress");
  const myCompletedTasks = myTasks.filter(t => t.status === "Completed");
  
  // Calculate total consumed/tracked hours dynamically
  const totalConsumedHours = myTasks.reduce((sum, t) => {
    const timerHours = t.totalActiveMs ? (t.totalActiveMs / (1000 * 60 * 60)) : 0;
    let runningSessionHours = 0;
    if (t.timerState === "running" && t.lastStartedAt) {
      const runningMs = Date.now() - new Date(t.lastStartedAt).getTime();
      if (runningMs > 0) {
        runningSessionHours = runningMs / (1000 * 60 * 60);
      }
    }
    const maxTracked = Math.max(t.actualHours || 0, timerHours + runningSessionHours);
    return sum + maxTracked;
  }, 0);
  
  // Calculate overdue tasks (Due date earlier than July 8, 2026)
  const today = new Date("2026-07-08T00:00:00Z");
  const myOverdueTasks = myPendingTasks.filter(t => new Date(t.dueDate).getTime() < today.getTime());

  // All Tasks calculations for Manager Dashboard
  const totalTasks = tasks.length;
  const completedTasksCount = tasks.filter(t => t.status === "Completed").length;
  const delayedTasks = tasks.filter(t => {
    if (t.status === "Completed") return false;
    return new Date(t.dueDate).getTime() < today.getTime();
  });
  
  // Progress Percentages
  const teamProgressPercent = totalTasks > 0 ? Math.round((completedTasksCount / totalTasks) * 100) : 0;
  const personalProgressPercent = myTasks.length > 0 ? Math.round((myCompletedTasks.length / myTasks.length) * 100) : 0;

  // Priority calculations
  const priorityCount = (list: Task[], p: TaskPriority) => list.filter(t => t.priority === p).length;

  // The dashboard follows the three workflow columns actually used in Kanban.
  const stageStats = {
    caseIntake: tasks.filter(t => t.status !== "Completed" && t.timerState !== "running" && t.stage === "Case Intake").length,
    inProgress: tasks.filter(t => t.status !== "Completed" && (t.timerState === "running" || t.stage === "In Progress")).length,
    completed: tasks.filter(t => t.status === "Completed" || t.stage === "Completed").length
  };

  // Group work hours per attorney
  const workloadByCounsel = users.map(u => {
    const userActiveTasks = tasks.filter(t => t.assignedTo === u.id && t.status !== "Completed");
    const hours = userActiveTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      activeTasksCount: userActiveTasks.length,
      uncompletedHours: hours,
      avatar: u.avatar
    };
  });

  const getPriorityBadgeClass = (p: TaskPriority) => {
    switch (p) {
      case "Critical":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "High":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "Medium":
        return "bg-sky-50 text-sky-700 border-sky-200";
      default:
        return "bg-slate-50 text-slate-600 border-slate-200";
    }
  };

  const getStageLabel = (stage: TaskStage) => {
    const labels: Record<TaskStage, string> = {
      "Case Intake": "Case Intake",
      "In Progress": "In Progress",
      "Completed": "Completed"
    };
    return labels[stage] || stage;
  };

  const currentHour = currentDateTime.getHours();
  const greeting = currentHour < 12 ? "Good Morning" : currentHour < 17 ? "Good Afternoon" : "Good Evening";

  return (
    <div className="space-y-6 text-slate-800">
      
      {/* Premium Minimalist Greeting & Presence Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="bg-white border border-slate-200/60 rounded-3xl p-8 md:p-10 relative overflow-hidden flex flex-col md:flex-row md:items-center md:justify-between gap-6 soft-shadow"
      >
        {/* Soft elegant radial ambient blur */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-800/5 rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400 block font-sans">
              {currentDateTime.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase()}
            </span>
            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
              {greeting}, <span className="font-serif italic text-blue-900 font-bold">{currentUser.name}</span>
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-slate-900 font-sans font-bold tracking-tight text-lg flex items-baseline gap-1">
              <span>{currentDateTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}</span>
            </div>

            {todayAttendance && (
              <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-xl text-xs text-slate-650 font-medium">
                <span className={`h-1.5 w-1.5 rounded-full ${todayAttendance.status === "Open" ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
                <span>{todayAttendance.status === "Open" ? "Clocked In" : "Clocked Out"}</span>
                <span className="text-slate-300">•</span>
                <span className="font-mono text-slate-700">IN {new Date(todayAttendance.clockInTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</span>
                {todayAttendance.clockOutTime && <span className="font-mono text-slate-700">OUT {new Date(todayAttendance.clockOutTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</span>}
                <span className="text-slate-300">•</span>
                <span className="text-xs bg-amber-50/50 text-blue-900 border border-amber-200 font-bold px-1 rounded uppercase font-mono">
                  {todayAttendance.type}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Minimalist Action Controls */}
        <div className="shrink-0">
          {!todayAttendance ? (
            <button
              onClick={() => {
                setPresenceModalStep("options");
                setShowPresenceModal(true);
                setLeaveSuccess("");
                setAttendanceError("");
              }}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-700 to-cyan-600 hover:from-blue-800 hover:to-cyan-700 text-white text-xs font-bold tracking-wide rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer shadow-xs border-0"
            >
              <UserCheck className="h-4 w-4" />
              <span>Mark Attendance</span>
            </button>
          ) : todayAttendance.status === "Open" ? (
            <div className="flex items-center gap-2 bg-slate-50/60 border border-slate-100 p-1 rounded-xl">
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {todayAttendance.type}
              </span>
              <button
                onClick={handleClockOut}
                disabled={checkingIn}
                className="px-3 py-1.5 bg-white hover:bg-rose-50 text-slate-650 hover:text-rose-700 text-xs font-semibold rounded-xl transition-all border border-slate-200 hover:border-rose-200 cursor-pointer active:scale-95 flex items-center gap-1 shadow-3xs"
              >
                <Clock className="h-3.5 w-3.5" />
                <span>Clock Out</span>
              </button>
            </div>
          ) : <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700">Attendance complete for today</div>}
        </div>
      </motion.div>

      {/* Embedded Minimalist Feedback Alerts */}
      {(attendanceError || leaveSuccess) && (
        <div className="space-y-2">
          {attendanceError && (
            <div className="p-3 bg-rose-50 border border-rose-100 text-rose-800 text-xs font-semibold flex items-center gap-2 rounded-xl">
              <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
              <span>{attendanceError}</span>
            </div>
          )}
          {leaveSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs font-semibold flex items-center gap-2 rounded-xl">
              <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{leaveSuccess}</span>
            </div>
          )}
        </div>
      )}

      {/* Personal Dashboard Widgets */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-blue-900" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-450 font-display">Your Tasks</h2>
        </div>

        {/* Fast summaries */}
      <div className="grid grid-cols-1 min-[390px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 auto-rows-fr gap-3 sm:gap-5">
          <motion.div
            custom={0}
            initial="hidden"
            animate="visible"
            variants={cardEntrance}
            whileHover={{ scale: 1.035, y: -4 }}
            className="bg-gradient-to-br from-violet-100 to-indigo-200 p-6 rounded-3xl relative overflow-hidden soft-shadow h-full flex flex-col justify-center"
          >
            <span className="text-xs font-bold text-indigo-900/60 uppercase tracking-wider block">Assigned</span>
            <div className="text-3xl font-black mt-2 font-mono text-indigo-950">{myTasks.length}</div>
            <p className="mt-1.5 text-xs text-indigo-900/60 font-semibold">Active & done</p>
          </motion.div>

          <motion.div
            custom={1}
            initial="hidden"
            animate="visible"
            variants={cardEntrance}
            whileHover={{ scale: 1.035, y: -4 }}
            className="bg-gradient-to-br from-amber-100 to-orange-200 p-6 rounded-3xl relative overflow-hidden soft-shadow h-full flex flex-col justify-center"
          >
            <span className="text-xs font-bold text-amber-900/60 uppercase tracking-wider block">In Progress</span>
            <div className="text-3xl font-black mt-2 text-amber-950 font-mono">{myInProgressTasks.length}</div>
            <p className="mt-1.5 text-xs text-amber-900/60 font-semibold">Currently working</p>
          </motion.div>

          <motion.div
            custom={2}
            initial="hidden"
            animate="visible"
            variants={cardEntrance}
            whileHover={{ scale: 1.035, y: -4 }}
            className="bg-gradient-to-br from-emerald-100 to-teal-200 p-6 rounded-3xl relative overflow-hidden soft-shadow h-full flex flex-col justify-center"
          >
            <span className="text-xs font-bold text-emerald-900/60 uppercase tracking-wider block">Completed</span>
            <div className="text-3xl font-black mt-2 text-emerald-950 font-mono">{myCompletedTasks.length}</div>
            <p className="mt-1.5 text-xs text-emerald-900/70 font-semibold">{personalProgressPercent}% done</p>
          </motion.div>

          <motion.div
            custom={3}
            initial="hidden"
            animate="visible"
            variants={cardEntrance}
            whileHover={{ scale: 1.035, y: -4 }}
            className="bg-gradient-to-br from-rose-100 to-pink-200 p-6 rounded-3xl relative overflow-hidden soft-shadow h-full flex flex-col justify-center"
          >
            <span className="text-xs font-bold text-rose-900/60 uppercase tracking-wider block">Overdue</span>
            <div className="text-3xl font-black mt-2 text-rose-950 font-mono">{myOverdueTasks.length}</div>
            <p className="mt-1.5 text-xs text-rose-900/70 font-semibold">Past due date</p>
          </motion.div>

          <motion.div
            custom={4}
            initial="hidden"
            animate="visible"
            variants={cardEntrance}
            whileHover={{ scale: 1.035, y: -4 }}
            className="bg-gradient-to-br from-sky-100 to-blue-200 p-6 rounded-3xl relative overflow-hidden soft-shadow h-full flex flex-col justify-center"
          >
            <span className="text-xs font-bold text-blue-900/60 uppercase tracking-wider block">Hours Tracked</span>
            <div className="text-3xl font-black mt-2 text-blue-950 font-mono">
              {totalConsumedHours.toFixed(1)} <span className="text-xs font-semibold text-blue-900/60">hrs</span>
            </div>
            <p className="mt-1.5 text-xs text-blue-900/60 font-semibold">Time logged</p>
          </motion.div>
        </div>

        {/* Personal Grid layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* List of active personal tasks */}
          <motion.div
            custom={5}
            initial="hidden"
            animate="visible"
            variants={cardEntrance}
            className="lg:col-span-8 bg-white border border-slate-200 rounded-3xl p-6 soft-shadow space-y-5"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700">Needs Your Attention</h3>
              <span className="text-xs text-slate-400 font-mono bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-150">Pending: {myPendingTasks.length}</span>
            </div>

            <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto pr-1">
              {myPendingTasks.map((t, idx) => (
                <motion.div
                  key={t.id}
                  onClick={() => onSelectTask(t)}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.35, delay: Math.min(idx, 8) * 0.04 }}
                  whileHover={{ x: 4 }}
                  className="py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/50 hover:shadow-sm px-3 rounded-xl transition-colors border border-transparent group"
                >
                  <div className={`h-11 w-11 rounded-2xl shrink-0 flex items-center justify-center ${
                    t.priority === "Critical" ? "bg-rose-100 text-rose-600" :
                    t.priority === "High" ? "bg-amber-100 text-amber-600" :
                    t.priority === "Medium" ? "bg-sky-100 text-sky-600" : "bg-slate-100 text-slate-500"
                  }`}>
                    <ShieldAlert className="h-5 w-5" />
                  </div>

                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold font-mono text-slate-450 uppercase tracking-wider">
                        {t.id.slice(-4).toUpperCase()}
                      </span>
                      <h4 className="font-bold text-sm text-slate-800 truncate group-hover:text-blue-900 transition-colors">
                        {t.title}
                      </h4>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-450 font-medium">
                      <span>{t.projectName}</span>
                      <span>•</span>
                      <span className={t.priority === "Critical" ? "text-rose-600 font-bold" : "text-slate-450"}>
                        {t.priority} Priority
                      </span>
                      {t.isBillable && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-600 font-bold">Billable</span>
                        </>
                      )}
                      {t.totalActiveMs ? (
                        <>
                          <span>•</span>
                          <span className="font-mono font-bold text-slate-600">⏱️ {(t.totalActiveMs / (1000 * 60 * 60)).toFixed(1)}h</span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Play/Pause/Complete control */}
                  {t.status !== "Completed" ? (
                    t.timerState === "running" ? (
                      <button
                        type="button"
                        title="Pause Active Timer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPauseTask?.(t);
                        }}
                        className="h-10 w-10 shrink-0 rounded-full bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center transition-all cursor-pointer shadow-md active:scale-95"
                      >
                        <Pause className="h-4 w-4 fill-white" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        title="Start/Resume Timer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPlayTask?.(t);
                        }}
                        className="h-10 w-10 shrink-0 rounded-full bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center transition-all cursor-pointer shadow-md active:scale-95"
                      >
                        <Play className="h-4 w-4 fill-white ml-0.5" />
                      </button>
                    )
                  ) : (
                    <span className="h-10 w-10 shrink-0 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                      <Check className="h-4 w-4" />
                    </span>
                  )}

                  <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                    <span className="text-sm font-bold text-amber-700 whitespace-nowrap flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(t.dueDate).toLocaleDateString()}
                    </span>
                  </div>
                </motion.div>
              ))}

              {myPendingTasks.length === 0 && (
                <div className="text-center py-16 text-slate-400 font-medium text-xs">
                  No pending tasks. You're all caught up.
                </div>
              )}
            </div>
          </motion.div>

          {/* Priority breakdown and upcoming deadlines cards */}
          <div className="lg:col-span-4 space-y-6">

            {/* Priority Distribution */}
            <motion.div
              custom={6}
              initial="hidden"
              animate="visible"
              variants={cardEntrance}
              className="bg-white border border-slate-200 rounded-3xl p-6 soft-shadow space-y-5"
            >
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700">Priority Breakdown</h3>
              <div className="space-y-4 text-xs">

                {/* Critical */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-slate-600">
                    <span className="font-bold text-sm flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" /> Critical</span>
                    <span className="font-bold">{priorityCount(myTasks, "Critical")}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${myTasks.length > 0 ? (priorityCount(myTasks, "Critical") / myTasks.length) * 100 : 0}%` }}
                      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                      className="h-full bg-rose-500"
                    />
                  </div>
                </div>

                {/* High */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-slate-600">
                    <span className="font-bold text-sm flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> High</span>
                    <span className="font-bold">{priorityCount(myTasks, "High")}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${myTasks.length > 0 ? (priorityCount(myTasks, "High") / myTasks.length) * 100 : 0}%` }}
                      transition={{ duration: 0.6, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                      className="h-full bg-amber-500"
                    />
                  </div>
                </div>

                {/* Medium */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-slate-600">
                    <span className="font-bold text-sm flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" /> Medium</span>
                    <span className="font-bold">{priorityCount(myTasks, "Medium")}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${myTasks.length > 0 ? (priorityCount(myTasks, "Medium") / myTasks.length) * 100 : 0}%` }}
                      transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                      className="h-full bg-sky-500"
                    />
                  </div>
                </div>

                {/* Low */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-slate-600">
                    <span className="font-bold text-sm flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-400" /> Low</span>
                    <span className="font-bold">{priorityCount(myTasks, "Low")}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${myTasks.length > 0 ? (priorityCount(myTasks, "Low") / myTasks.length) * 100 : 0}%` }}
                      transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
                      className="h-full bg-slate-400"
                    />
                  </div>
                </div>

              </div>
            </motion.div>

            {/* Upcoming items banner */}
            <motion.div
              custom={7}
              initial="hidden"
              animate="visible"
              variants={cardEntrance}
              className="bg-gradient-to-br from-amber-50 to-orange-100/60 border border-amber-200 rounded-3xl p-6 soft-shadow space-y-4"
            >
              <h3 className="font-bold text-xs text-blue-900 uppercase tracking-wider">Upcoming Deadlines</h3>
              <div className="space-y-2.5 max-h-[140px] overflow-y-auto pr-1">
                {myPendingTasks.slice(0, 3).map((t, idx) => {
                  const daysLeft = Math.ceil((new Date(t.dueDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  return (
                    <div key={idx} className="flex justify-between items-center bg-white border border-slate-150 px-4 py-2.5 rounded-xl text-xs transition-all hover:shadow-sm hover:border-slate-300">
                      <span className="truncate max-w-[130px] text-slate-700 font-bold">{t.title}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold border ${
                        daysLeft < 0 ? "bg-rose-50 text-rose-700 border-rose-200" :
                        daysLeft === 0 ? "bg-amber-50 text-amber-700 border-amber-200 animate-pulse" : "bg-amber-50 text-blue-900 border-amber-200"
                      }`}>
                        {daysLeft < 0 ? `${Math.abs(daysLeft)}d Overdue` : daysLeft === 0 ? "Due Today" : `${daysLeft}d left`}
                      </span>
                    </div>
                  );
                })}
                {myPendingTasks.length === 0 && (
                  <span className="text-xs text-slate-400 italic">No upcoming deadlines.</span>
                )}
              </div>
            </motion.div>

          </div>

        </div>
      </div>

      {/* MANAGER / ADMIN DASHBOARD SECTION */}
      {isManagerOrAdmin && (
        <div className="space-y-6 pt-4 border-t border-slate-200">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-900" />
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-700">Team Overview</h2>
            <span className="text-xs bg-amber-100 text-blue-900 px-2.5 py-0.5 rounded-full border border-amber-200 font-bold uppercase">Admin</span>
          </div>

          {/* Core Analytics Cards */}
          <div className="grid grid-cols-1 min-[390px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
            <motion.div
              custom={0}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.4 }}
              variants={cardEntrance}
              whileHover={{ scale: 1.035, y: -4 }}
              className="bg-gradient-to-br from-sky-100 to-blue-200 p-6 rounded-3xl soft-shadow relative overflow-hidden"
            >
              <span className="text-xs font-bold text-blue-900/60 uppercase tracking-wider block">Active Cases</span>
              <div className="text-3xl font-black mt-2 font-mono text-blue-950">{totalTasks}</div>
              <div className="mt-1.5 text-xs text-blue-900/60 font-semibold">
                Across all clients
              </div>
            </motion.div>

            <motion.div
              custom={1}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.4 }}
              variants={cardEntrance}
              whileHover={{ scale: 1.035, y: -4 }}
              className="bg-gradient-to-br from-emerald-100 to-teal-200 p-6 rounded-3xl soft-shadow relative overflow-hidden"
            >
              <span className="text-xs font-bold text-emerald-900/60 uppercase tracking-wider block">Resolved Cases</span>
              <div className="text-3xl font-black mt-2 text-emerald-950 font-mono">{completedTasksCount}</div>
              <div className="mt-1.5 text-xs text-emerald-900/70 font-semibold">
                {teamProgressPercent}% resolved
              </div>
            </motion.div>

            <motion.div
              custom={2}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.4 }}
              variants={cardEntrance}
              whileHover={{ scale: 1.035, y: -4 }}
              className="bg-gradient-to-br from-rose-100 to-red-200 p-6 rounded-3xl soft-shadow relative overflow-hidden"
            >
              <span className="text-xs font-bold text-rose-900/60 uppercase tracking-wider block">Blocked</span>
              <div className="text-3xl font-black mt-2 text-rose-950 font-mono">{tasks.filter(t => t.status === "Blocked").length}</div>
              <div className="mt-1.5 text-xs text-rose-900/70 font-semibold flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" /> Needs review
              </div>
            </motion.div>

            <motion.div
              custom={3}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.4 }}
              variants={cardEntrance}
              whileHover={{ scale: 1.035, y: -4 }}
              className="bg-gradient-to-br from-fuchsia-100 to-pink-200 p-6 rounded-3xl soft-shadow relative overflow-hidden"
            >
              <span className="text-xs font-bold text-fuchsia-900/60 uppercase tracking-wider block">Overdue</span>
              <div className="text-3xl font-black mt-2 text-fuchsia-950 font-mono">{delayedTasks.length}</div>
              <div className="mt-1.5 text-xs text-fuchsia-900/60 font-semibold">
                Past due date
              </div>
            </motion.div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Task Status Visual Chart (Responsive SVG Bar) */}
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-3xl p-6 soft-shadow space-y-5 hover-lift">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700">Case Stage Breakdown</h3>
                  <p className="mt-1 text-[11px] text-slate-400">Live totals from the three Kanban workflow columns</p>
                </div>
                <PieChart className="h-4.5 w-4.5 text-blue-900" />
              </div>

              <div className="space-y-4 pt-2 text-xs">

                {/* Case Intake */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-slate-600 font-bold text-sm">
                    <span>Case Intake</span>
                    <span className="font-bold font-mono text-slate-800">{stageStats.caseIntake} tasks</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      style={{ width: `${totalTasks > 0 ? (stageStats.caseIntake / totalTasks) * 100 : 0}%` }}
                      className="h-full bg-sky-500"
                    />
                  </div>
                </div>

                {/* In Progress */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-slate-600 font-bold text-sm">
                    <span>In Progress</span>
                    <span className="font-bold font-mono text-slate-800">{stageStats.inProgress} tasks</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      style={{ width: `${totalTasks > 0 ? (stageStats.inProgress / totalTasks) * 100 : 0}%` }}
                      className="h-full bg-amber-500"
                    />
                  </div>
                </div>

                {/* Completed */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-slate-600 font-bold text-sm">
                    <span>Completed</span>
                    <span className="font-bold font-mono text-slate-800">{stageStats.completed} tasks</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      style={{ width: `${totalTasks > 0 ? (stageStats.completed / totalTasks) * 100 : 0}%` }}
                      className="h-full bg-emerald-500"
                    />
                  </div>
                </div>

              </div>
              <details className="stage-key-details">
                <summary>Stage key <span>How tasks move automatically</span></summary>
                <div className="stage-key-content">
                  <div><i className="bg-sky-500"/><strong>Case Intake</strong><span>New case created</span></div>
                  <div><i className="bg-blue-600"/><strong>In Progress</strong><span>Timer started</span></div>
                  <div><i className="bg-emerald-500"/><strong>Completed</strong><span>Marked complete</span></div>
                  <p><strong>Automatic flow:</strong> New case → Case Intake, timer started → In Progress, complete marked → Completed.</p>
                </div>
              </details>
            </div>

            {/* Legal Team Workload Distribution Tracker */}
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-3xl p-6 soft-shadow space-y-5 hover-lift">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700">Team Workload</h3>
                <TrendingUp className="h-4.5 w-4.5 text-blue-900" />
              </div>

              <div className="divide-y divide-slate-100 pr-1 max-h-[300px] overflow-y-auto">
                {workloadByCounsel.map((u, i) => {
                  const userAttendance = allAttendances.find(a => a.userId === u.userId && a.status === "Open");
                  const activeTimerTask = tasks.find(t => t.assignedTo === u.userId && t.timerState === "running");

                  return (
                    <div key={i} className="py-4 flex flex-col gap-2.5 text-xs px-3 -mx-3 rounded-xl transition-all hover:bg-slate-50/50">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <img
                            src={u.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=60"}
                            alt={u.name}
                            referrerPolicy="no-referrer"
                            className="h-8 w-8 rounded-full object-cover border border-slate-200"
                          />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-800">{u.name}</span>
                              {userAttendance ? (
                                <span className={`text-xs font-black uppercase px-1.5 py-0.2 rounded border ${
                                  userAttendance.type === "WFO"
                                    ? "bg-amber-50 text-blue-900 border-amber-200"
                                    : "bg-teal-50 text-teal-700 border-teal-200"
                                }`}>
                                  {userAttendance.type}
                                </span>
                              ) : (
                                <span className="text-xs font-bold uppercase px-1.5 py-0.2 rounded border bg-slate-50 text-slate-400 border-slate-200">
                                  OFFLINE
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="font-bold text-blue-900 font-mono">{u.activeTasksCount} active cases</div>
                        </div>
                      </div>

                      {/* Active Task progress display */}
                      {activeTimerTask ? (
                        <div className="text-xs text-emerald-700 font-bold bg-emerald-50/50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2 animate-pulse">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span className="truncate">⚡ {activeTimerTask.title}</span>
                          </div>
                          <span className="font-mono text-xs uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1 py-0.2 rounded font-black shrink-0">
                            ACTIVE
                          </span>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 font-semibold italic pl-3 flex items-center gap-1">
                          <span className="h-1 w-1 rounded-full bg-slate-350" />
                          No active timer
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

                  {/* Pending Leaves Approval Sub-Panel */}
          {leaveRequests && leaveRequests.filter(l => l.status === "Pending").length > 0 && (
            <div className="bg-gradient-to-br from-amber-50 to-orange-100/60 border border-amber-200 rounded-3xl p-6 space-y-5 soft-shadow">
              <div className="flex items-center justify-between border-b border-amber-200 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">✈️</span>
                  <h3 className="font-extrabold text-sm uppercase tracking-wider text-slate-700 font-display">
                    Pending Leave Requests
                  </h3>
                </div>
                <span className="text-xs bg-amber-100 text-amber-800 px-3 py-1 rounded-full font-black uppercase tracking-wider">
                  Action Required ({leaveRequests.filter(l => l.status === "Pending").length})
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {leaveRequests.filter(l => l.status === "Pending").map((lv) => (
                  <div key={lv.id} className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 soft-shadow hover-lift">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-800 text-sm">{lv.userName}</span>
                        <span className="text-xs text-slate-550 font-semibold font-mono">({lv.startDate} to {lv.endDate})</span>
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        <span className="font-bold text-slate-400">Reason:</span> {lv.reason}
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <button
                        onClick={() => onUpdateLeaveStatus?.(lv.id, "Approved")}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-2xs cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                      >
                        <Check className="h-4 w-4" /> Approve
                      </button>
                      <button
                        onClick={() => onUpdateLeaveStatus?.(lv.id, "Rejected")}
                        className="px-4 py-2 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-250 text-slate-600 hover:text-rose-700 font-bold text-xs uppercase tracking-wider rounded-xl shadow-2xs cursor-pointer transition-all active:scale-95"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. MINIMALIST PRESENCE & LEAVE MODAL OVERLAY */}
      {showPresenceModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl p-6 md:p-8 max-w-md w-full border border-slate-100 shadow-2xl soft-shadow relative space-y-6">
            
            {/* Modal Close Button */}
            <button
              onClick={() => setShowPresenceModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-650 p-2 rounded-full hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {presenceModalStep === "options" ? (
              <div className="space-y-5 animate-slideIn">
                <div className="text-center space-y-1.5">
                  <span className="text-xs font-black tracking-widest uppercase text-blue-800">Check In</span>
                  <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Mark Attendance</h3>
                </div>

                <div className="space-y-3 pt-2">
                  {/* Office attendance is intentionally unavailable. */}
                  {false && <button
                    onClick={() => {
                      handleClockIn("WFO");
                      setShowPresenceModal(false);
                    }}
                    disabled={checkingIn}
                    className="w-full text-left p-4 rounded-2xl bg-slate-50 hover:bg-amber-50/45 border border-slate-100 hover:border-amber-200 transition-all duration-200 flex items-center justify-between group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-blue-900 group-hover:scale-105 transition-transform">
                        <span className="text-xl">🏢</span>
                      </div>
                      <div>
                        <h4 className="font-extrabold text-slate-800 text-base">Work From Office</h4>
                      </div>
                    </div>
                    <span className="text-xs text-blue-900 font-bold opacity-0 group-hover:opacity-100 transition-opacity">Select &rarr;</span>
                  </button>}

                  {/* Option 1: Work From Home */}
                  <button
                    onClick={() => {
                      handleClockIn("WFH");
                      setShowPresenceModal(false);
                    }}
                    disabled={checkingIn}
                    className="w-full text-left p-4 rounded-2xl bg-slate-50 hover:bg-teal-50/45 border border-slate-100 hover:border-teal-200 transition-all duration-200 flex items-center justify-between group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-xl bg-teal-50 border border-teal-100 text-teal-650 group-hover:scale-105 transition-transform">
                        <span className="text-xl">🏠</span>
                      </div>
                      <div>
                        <h4 className="font-extrabold text-slate-800 text-base">Work From Home</h4>
                      </div>
                    </div>
                    <span className="text-xs text-teal-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity">Select &rarr;</span>
                  </button>

                  {/* Option 2: Mark Leave */}
                  <button
                    onClick={() => {
                      setPresenceModalStep("leave");
                    }}
                    className="w-full text-left p-4 rounded-2xl bg-slate-50 hover:bg-rose-50/45 border border-slate-100 hover:border-rose-200 transition-all duration-200 flex items-center justify-between group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-rose-650 group-hover:scale-105 transition-transform">
                        <span className="text-xl">✈️</span>
                      </div>
                      <div>
                        <h4 className="font-extrabold text-slate-800 text-base">Mark Leave</h4>
                      </div>
                    </div>
                    <span className="text-xs text-rose-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity">Configure &rarr;</span>
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={async (e) => {
                e.preventDefault();
                const reason = leaveReasonChip + (leaveNote.trim() ? ` - ${leaveNote.trim()}` : "");
                if (!leaveStart || !leaveEnd || !leaveReasonChip) return;

                setLeaveSubmitting(true);
                setLeaveSuccess("");
                setAttendanceError("");
                try {
                  const res = await fetch("/api/leaves", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      userId: currentUser.id,
                      userName: currentUser.name,
                      startDate: leaveStart,
                      endDate: leaveEnd,
                      reason
                    })
                  });

                  if (res.ok) {
                    setLeaveSuccess(`Leave request submitted for ${leaveStart} to ${leaveEnd}.`);
                    setLeaveStart(todayStr());
                    setLeaveEnd(todayStr());
                    setLeaveReasonChip("");
                    setLeaveNote("");
                    setShowPresenceModal(false);
                    fetchAttendanceAndLeaves();
                  } else {
                    const err = await res.json();
                    setAttendanceError(err.error || "Failed to submit leave request.");
                  }
                } catch (err) {
                  setAttendanceError("Server unreachable.");
                } finally {
                  setLeaveSubmitting(false);
                }
              }} className="space-y-4 animate-slideIn">

                <div className="text-center space-y-1.5">
                  <span className="text-xs font-black tracking-widest uppercase text-rose-500">Time Off</span>
                  <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Request Leave</h3>
                  <p className="text-sm text-slate-500">Enter dates and reason for approval.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="text-xs uppercase font-black text-slate-400 tracking-wider block mb-1.5">Start Date</label>
                    <input
                      type="date"
                      required
                      value={leaveStart}
                      onChange={(e) => setLeaveStart(e.target.value)}
                      className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-xs text-slate-800 focus:border-blue-800 focus:ring-1 focus:ring-amber-500 focus:outline-hidden font-mono font-medium"
                    />
                  </div>

                  <div>
                    <label className="text-xs uppercase font-black text-slate-400 tracking-wider block mb-1.5">End Date</label>
                    <input
                      type="date"
                      required
                      value={leaveEnd}
                      onChange={(e) => setLeaveEnd(e.target.value)}
                      className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-xs text-slate-800 focus:border-blue-800 focus:ring-1 focus:ring-amber-500 focus:outline-hidden font-mono font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase font-black text-slate-400 tracking-wider block mb-1.5">Reason</label>
                  <div className="flex flex-wrap gap-2">
                    {leaveReasonOptions.map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => setLeaveReasonChip(opt.label)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer hover:-translate-y-0.5 flex items-center gap-1.5 ${
                          leaveReasonChip === opt.label
                            ? "bg-blue-900 border-blue-900 text-white shadow-xs"
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <span>{opt.emoji}</span>
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <textarea
                    rows={3}
                    value={leaveNote}
                    onChange={(e) => setLeaveNote(e.target.value)}
                    placeholder="Add a note for your manager (optional)..."
                    className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 focus:border-blue-800 focus:ring-1 focus:ring-amber-500 focus:outline-hidden placeholder-slate-400 resize-none font-medium"
                  />
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setPresenceModalStep("options")}
                    className="flex-1 py-3 bg-slate-150 hover:bg-slate-200 text-slate-700 font-extrabold text-sm uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center font-display"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={leaveSubmitting || !leaveReasonChip}
                    className="flex-2 py-3 bg-gradient-to-r from-blue-700 to-cyan-600 hover:from-blue-800 hover:to-cyan-700 disabled:opacity-50 text-white font-extrabold text-sm uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-xs font-display"
                  >
                    {leaveSubmitting ? "Submitting..." : "Submit"}
                  </button>
                </div>
              </form>
            )}

          </div>
        </div>
      )}

    </div>
  );
}
