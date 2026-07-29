import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { User, Attendance, LeaveRequest } from "../types";
import { 
  Clock, 
  Calendar, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  ChevronLeft, 
  ChevronRight, 
  UserCheck, 
  FileText, 
  Plus, 
  Check, 
  X, 
  Users, 
  Home, 
  CalendarCheck,
  Send,
  Loader2,
  Info
} from "lucide-react";

interface AttendanceLogsViewProps {
  currentUser: User;
  users: User[];
  onUpdateLeaveStatus: (leaveId: string, status: "Approved" | "Rejected") => void;
}

const leaveReasonOptions = [
  { emoji: "🤒", label: "Not feeling well" }, { emoji: "✈️", label: "Travel" },
  { emoji: "🏠", label: "Family" }, { emoji: "📝", label: "Personal work" },
  { emoji: "🎉", label: "Occasion" }, { emoji: "💍", label: "Wedding" }
];

export default function AttendanceLogsView({ 
  currentUser, 
  users, 
  onUpdateLeaveStatus 
}: AttendanceLogsViewProps) {
  // Default to the current local date dynamically as requested by the user
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
  });
  
  // Lists fetched from APIs
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  
  // Local loading / errors
  const [loading, setLoading] = useState(false);
  const [submittingClock, setSubmittingClock] = useState(false);
  const clockType = "WFH" as const;
  const [errorMessage, setErrorMessage] = useState("");
  
  // Leave Form states
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveSuccessMsg, setLeaveSuccessMsg] = useState("");
  const [leaveErrorMsg, setLeaveErrorMsg] = useState("");
  const [showLeaveLegend, setShowLeaveLegend] = useState(false);

  // Hover/Click leave reason state
  const [clickedReasonUserId, setClickedReasonUserId] = useState<string | null>(null);

  // Live timer for active session
  const [elapsedTime, setElapsedTime] = useState<string>("");

  useEffect(() => {
    fetchData();
  }, [currentUser.id]);

  async function fetchData() {
    setLoading(true);
    setErrorMessage("");
    try {
      const [attRes, leaveRes] = await Promise.all([
        fetch("/api/attendance"),
        fetch("/api/leaves")
      ]);
      if (attRes.ok) {
        const attData = await attRes.json();
        setAttendances(attData);
      }
      if (leaveRes.ok) {
        const leaveData = await leaveRes.json();
        setLeaves(leaveData);
      }
    } catch (e) {
      setErrorMessage("Failed to load attendance or leave data.");
    } finally {
      setLoading(false);
    }
  }

  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  const myTodaySession = attendances.find(
    (r) => r.userId === currentUser.id && r.date === todayKey && r.status === "Open"
  );
  const myTodayAttendance = attendances.find(
    (r) => r.userId === currentUser.id && r.date === todayKey
  );

  // Live clock timer effect
  useEffect(() => {
    if (!myTodaySession) {
      setElapsedTime("");
      return;
    }

    const interval = setInterval(() => {
      const clockInTime = new Date(myTodaySession.clockInTime).getTime();
      const diffMs = Date.now() - clockInTime;
      if (diffMs > 0) {
        const totalSecs = Math.floor(diffMs / 1000);
        const hrs = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;
        
        const hrsStr = hrs > 0 ? `${hrs.toString().padStart(2, "0")}h ` : "";
        const minsStr = `${mins.toString().padStart(2, "0")}m `;
        const secsStr = `${secs.toString().padStart(2, "0")}s`;
        setElapsedTime(`${hrsStr}${minsStr}${secsStr}`);
      } else {
        setElapsedTime("00m 00s");
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [myTodaySession]);

  const handleClockIn = async () => {
    setSubmittingClock(true);
    setErrorMessage("");
    try {
      const res = await fetch("/api/attendance/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUser.id,
          userName: currentUser.name,
          type: clockType
        })
      });
      if (res.ok) {
        await fetchData();
      } else {
        const err = await res.json();
        setErrorMessage(err.error || "Failed to register clock-in.");
      }
    } catch (e) {
      setErrorMessage("Network error during clock-in.");
    } finally {
      setSubmittingClock(false);
    }
  };

  const handleClockOut = async () => {
    setSubmittingClock(true);
    setErrorMessage("");
    try {
      const res = await fetch("/api/attendance/clock-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser.id })
      });
      if (res.ok) {
        await fetchData();
      } else {
        const err = await res.json();
        setErrorMessage(err.error || "Failed to register clock-out.");
      }
    } catch (e) {
      setErrorMessage("Network error during clock-out.");
    } finally {
      setSubmittingClock(false);
    }
  };

  const handleApplyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLeaveSuccessMsg("");
    setLeaveErrorMsg("");

    if (!leaveStart || !leaveEnd || !leaveReason.trim()) {
      setLeaveErrorMsg("All fields are required to request leave.");
      return;
    }

    setLeaveSubmitting(true);
    try {
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUser.id,
          userName: currentUser.name,
          startDate: leaveStart,
          endDate: leaveEnd,
          reason: leaveReason.trim()
        })
      });

      if (res.ok) {
        setLeaveSuccessMsg("Leave requested successfully. Pending admin approval.");
        setLeaveStart("");
        setLeaveEnd("");
        setLeaveReason("");
        await fetchData();
      } else {
        const err = await res.json();
        setLeaveErrorMsg(err.error || "Failed to submit leave request.");
      }
    } catch (e) {
      setLeaveErrorMsg("Server connection failure.");
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, status: "Approved" | "Rejected") => {
    onUpdateLeaveStatus(id, status);
    // Refresh lists after brief delay for server persistence
    setTimeout(() => {
      fetchData();
    }, 300);
  };

  // Helper date navigation controls
  const handlePrevDate = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d.toISOString().split("T")[0]);
  };

  const handleNextDate = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d.toISOString().split("T")[0]);
  };

  // Humanize selectedDate string to match screen exactly: "Wednesday 08 Jul 2026"
  const getReadableSelectedDate = () => {
    const d = new Date(selectedDate);
    const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
    const day = d.toLocaleDateString("en-US", { day: "2-digit" });
    const month = d.toLocaleDateString("en-US", { month: "short" });
    const year = d.getFullYear();
    return `${weekday}, ${day} ${month} ${year}`;
  };

  // Parse attendance logs for the selected date
  const selectedDateLogs = attendances.filter((att) => att.date === selectedDate);

  // Compute status for all team members on the selected date
  const getTeamMemberStatusOnSelectedDate = (member: User) => {
    // 1. Check if user is on approved leave covering selectedDate
    const isUserOnLeave = leaves.some((lv) => {
      if (lv.userId !== member.id || lv.status !== "Approved") return false;
      const start = new Date(lv.startDate).getTime();
      const end = new Date(lv.endDate).getTime();
      const current = new Date(selectedDate).getTime();
      return current >= start && current <= end;
    });

    if (isUserOnLeave) {
      const activeLeave = leaves.find((lv) => {
        if (lv.userId !== member.id || lv.status !== "Approved") return false;
        const start = new Date(lv.startDate).getTime();
        const end = new Date(lv.endDate).getTime();
        const current = new Date(selectedDate).getTime();
        return current >= start && current <= end;
      });
      return {
        status: "On Leave" as const,
        timeStr: null,
        type: null,
        label: "On Approved Leave",
        badgeStyle: "bg-purple-50 text-purple-700 border-purple-200",
        leaveReason: activeLeave?.reason
      };
    }

    // 2. Check if user has an attendance record on selectedDate
    const record = attendances.find((att) => att.userId === member.id && att.date === selectedDate);
    if (record) {
      const clockInIso = record.clockInTime;
      const clockInDate = new Date(clockInIso);
      
      // Determine late based on standard hour (e.g. clocked in after 10:00 AM local)
      const indiaTimeParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false
      }).formatToParts(clockInDate);
      const clockInHour = Number(indiaTimeParts.find(p => p.type === "hour")?.value || 0);
      const clockInMinutes = Number(indiaTimeParts.find(p => p.type === "minute")?.value || 0);
      const isLate = (clockInHour > 10) || (clockInHour === 10 && clockInMinutes > 0);

      const timeStr = clockInDate.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata"
      });
      const clockOutStr = record.clockOutTime ? new Date(record.clockOutTime).toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata"
      }) : null;

      return {
        status: isLate ? ("Late" as const) : ("Present" as const),
        timeStr,
        clockOutStr,
        type: record.type,
        label: isLate ? "Late" : "Present",
        badgeStyle: isLate 
          ? "bg-amber-50 text-amber-700 border-amber-100" 
          : "bg-emerald-50 text-emerald-700 border-emerald-100"
      };
    }

    // 3. Otherwise, marked absent
    return {
      status: "Absent" as const,
      timeStr: null,
      clockOutStr: null,
      type: null,
      label: "Absent",
      badgeStyle: "bg-rose-50 text-rose-700 border-rose-100"
    };
  };

  // Compile team statuses for today
  const attendanceMembers = users.some(member => member.id === currentUser.id)
    ? users
    : [currentUser, ...users];
  const teamStatuses = attendanceMembers.map((member) => {
    const statusData = getTeamMemberStatusOnSelectedDate(member);
    return {
      member,
      ...statusData
    };
  });

  // Calculate statistics for selected date
  const totalPresent = teamStatuses.filter(t => t.status === "Present" || t.status === "Late").length;
  const totalAbsent = teamStatuses.filter(t => t.status === "Absent").length;
  const totalOnLeave = teamStatuses.filter(t => t.status === "On Leave").length;

  const isManagerOrAdmin = currentUser.role === "Admin" || currentUser.role === "Manager";

  return (
    <div className="space-y-6">

      {/* 1. HEADER BANNER */}
      <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 border border-blue-900/60 rounded-[28px] p-6 md:p-7 shadow-xl relative overflow-hidden text-white flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-64 h-64 bg-blue-800/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center gap-4 relative">
          <div className="rounded-2xl bg-white/10 border border-white/10 p-3.5 text-blue-100 shadow-xs">
            <Clock className="h-6 w-6 animate-pulse" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight font-display">
              Attendance Analytics
            </h2>
            <p className="text-xs text-blue-100/70 font-medium mt-1">
              Daily, date-wise visibility for presence, absence and approved leave.
            </p>
          </div>
        </div>

        <div className="relative flex flex-col items-stretch gap-2 md:items-end">
          {myTodayAttendance && (
            <div className="flex items-center gap-3 text-[11px] font-semibold text-blue-100">
              <span>IN <strong className="font-mono text-white">{new Date(myTodayAttendance.clockInTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</strong></span>
              <span className="text-white/30">→</span>
              <span>OUT <strong className="font-mono text-white">{myTodayAttendance.clockOutTime ? new Date(myTodayAttendance.clockOutTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—"}</strong></span>
            </div>
          )}
          {!myTodayAttendance ? (
            <button onClick={handleClockIn} disabled={submittingClock} className="rounded-xl bg-white px-5 py-2.5 text-xs font-extrabold text-blue-950 shadow-lg transition hover:bg-blue-50 disabled:opacity-50">
              {submittingClock ? "Checking in..." : "Check In · WFH"}
            </button>
          ) : myTodaySession ? (
            <button onClick={handleClockOut} disabled={submittingClock} className="rounded-xl bg-rose-500 px-5 py-2.5 text-xs font-extrabold text-white shadow-lg transition hover:bg-rose-600 disabled:opacity-50">
              {submittingClock ? "Checking out..." : "Check Out"}
            </button>
          ) : (
            <span className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-2 text-xs font-bold text-emerald-200">Attendance completed for today</span>
          )}
        </div>

      </div>

      {/* Error displays */}
      {errorMessage && (
        <div className="bg-rose-50 border border-rose-100 text-rose-700 px-5 py-4 rounded-2xl text-xs font-semibold flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 2. DATE NAVIGATION SLIDER - EXACT REPLICA OF THE SCREENSHOT */}
      <div className="bg-white border border-slate-200 rounded-2xl px-5 py-3.5 flex items-center justify-between soft-shadow">
        <button
          onClick={handlePrevDate}
          className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-600 transition-all cursor-pointer active:scale-95"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="text-center space-y-1">
          <span className="text-xs text-slate-400 font-extrabold uppercase tracking-wider block font-display">
            Viewing
          </span>
          <span className="text-base font-extrabold text-slate-900 font-mono">
            {getReadableSelectedDate()}
          </span>
        </div>

        <button
          onClick={handleNextDate}
          className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-600 transition-all cursor-pointer active:scale-95"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* 3. METRICS OVERVIEW GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          whileHover={{ scale: 1.035, y: -4 }}
          className="bg-white border border-emerald-100 p-4 rounded-2xl flex items-center gap-4 soft-shadow"
        >
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
            <CheckCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <span className="text-2xl font-extrabold text-slate-900 font-mono">{totalPresent}</span>
            <span className="text-xs uppercase font-extrabold text-emerald-700 tracking-wider block">Present</span>
            <span className="text-[11px] text-slate-400">{attendanceMembers.length ? Math.round(totalPresent / attendanceMembers.length * 100) : 0}% of team</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
          whileHover={{ scale: 1.035, y: -4 }}
          className="bg-white border border-rose-100 p-4 rounded-2xl flex items-center gap-4 soft-shadow"
        >
          <div className="rounded-xl bg-rose-50 p-3 text-rose-700">
            <XCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <span className="text-2xl font-extrabold text-slate-900 font-mono">{totalAbsent}</span>
            <span className="text-xs uppercase font-extrabold text-rose-700 tracking-wider block">Absent</span>
            <span className="text-[11px] text-slate-400">{attendanceMembers.length ? Math.round(totalAbsent / attendanceMembers.length * 100) : 0}% of team</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          whileHover={{ scale: 1.035, y: -4 }}
          className="bg-white border border-violet-100 p-4 rounded-2xl flex items-center gap-4 soft-shadow"
        >
          <div className="rounded-xl bg-violet-50 p-3 text-violet-700">
            <CalendarCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <span className="text-2xl font-extrabold text-slate-900 font-mono">{totalOnLeave}</span>
            <span className="text-xs uppercase font-extrabold text-violet-700 tracking-wider block">On Leave</span>
            <span className="text-[11px] text-slate-400">Approved requests</span>
          </div>
        </motion.div>
      </div>

      {/* 4. TEAM MEMBERS ATTENDANCE STATUS DIRECTORY */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* Left Side: Team members list on selected date */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 soft-shadow space-y-4 h-fit hover-lift transition-all min-w-0">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
            <Users className="h-5 w-5 text-blue-800" />
            <h3 className="font-extrabold text-sm uppercase tracking-wider text-slate-700 font-display">
              Team Attendance
            </h3>
          </div>

          <div className="divide-y divide-slate-100">
            {teamStatuses.map(({ member, status, timeStr, clockOutStr, type, label, badgeStyle, leaveReason }) => (
              <div
                key={member.id}
                className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-5 group transition-all hover:bg-slate-50/50 hover:-translate-y-0.5 px-2 rounded-xl min-w-0"
              >
                {/* User avatar & name */}
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                  {member.avatar ? (
                    <img
                      src={member.avatar}
                      alt={member.name}
                      className="h-10 w-10 rounded-xl object-cover border border-slate-200"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 font-black text-xs font-mono">
                      {member.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}

                  <div className="space-y-0.5 min-w-0">
                    <span className="font-extrabold text-sm text-slate-900 block group-hover:text-blue-950 transition-colors">
                      {member.name}
                    </span>
                    <span className="text-xs text-slate-450 block font-medium">
                      {member.role === "Admin" ? "Firm Admin" : member.role === "Manager" ? "Partner" : "Associate"} • {member.department}
                    </span>
                  </div>
                </div>

                {/* Clock-in info / Status Badges */}
                <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 w-full sm:w-auto pl-12 sm:pl-0">
                  {timeStr && (
                    <div className="text-right space-y-0.5 hidden sm:block">
                      <div className="flex items-center gap-1 text-[11px] font-bold text-slate-700 font-mono">
                        <CheckCircle className="h-3 w-3 text-emerald-500" />
                        <span>IN {timeStr}</span>
                      </div>
                      <div className="text-[11px] font-bold text-slate-500 font-mono">OUT {clockOutStr || "—"}</div>
                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center justify-end gap-1 font-mono"><Home className="h-2.5 w-2.5" />{type}</span>
                    </div>
                  )}

                  {/* Leave details hoverable & clickable tooltip */}
                  {leaveReason && (
                    <div className="relative group/reason">
                      {/* Click trigger button */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setClickedReasonUserId(clickedReasonUserId === member.id ? null : member.id); }}
                        className="text-sm font-bold text-blue-900 hover:text-blue-950 bg-amber-50/70 hover:bg-amber-100/80 px-2 py-0.8 rounded-lg border border-amber-200 transition-all flex items-center gap-1 cursor-pointer shrink-0"
                        title="Click to toggle or hover to view leave reason"
                      >
                        <span>Reason ℹ</span>
                      </button>

                      {/* Click overlay tooltip */}
                      {clickedReasonUserId === member.id && (
                        <div className="absolute right-0 bottom-full mb-2 w-52 bg-slate-900 text-white text-sm p-3 rounded-xl shadow-xl z-30 font-medium leading-relaxed border border-slate-800">
                          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5 font-bold text-slate-300">
                            <span>Reason</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); setClickedReasonUserId(null); }}
                              aria-label="Close"
                              title="Close"
                              className="grid h-5 w-5 place-items-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                          <div>"{leaveReason}"</div>
                        </div>
                      )}

                      {/* Pure CSS hover tooltip */}
                      <div className="absolute right-0 bottom-full mb-2 w-52 bg-slate-900 text-white text-sm p-3 rounded-xl shadow-xl z-20 font-medium leading-relaxed border border-slate-800 pointer-events-none opacity-0 group-hover/reason:opacity-100 transition-opacity duration-250">
                        <div className="border-b border-slate-800 pb-1.5 mb-1.5 font-bold text-slate-300">
                          Reason
                        </div>
                        <div>"{leaveReason}"</div>
                      </div>
                    </div>
                  )}

                  <span className={`text-xs px-3 py-1 rounded-full font-black uppercase tracking-wider border shrink-0 ${badgeStyle}`}>
                    {label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Side: Leaves Request portal */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Section A: Request Leave form */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 soft-shadow space-y-5 hover-lift transition-all">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="font-extrabold text-sm uppercase tracking-wider text-slate-700 font-display flex items-center gap-1.5">
                ✈️ Request Leave
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 font-medium">
                Submit a time-off request for approval.
              </p>
            </div>

            <form id="leave-request-form" onSubmit={handleApplyLeave} className="space-y-5 scroll-mt-24">
              {leaveSuccessMsg && (
                <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{leaveSuccessMsg}</span>
                </div>
              )}

              {leaveErrorMsg && (
                <div className="bg-rose-50 border border-rose-100 text-rose-700 p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
                  <span>{leaveErrorMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs uppercase font-extrabold tracking-wider text-slate-400 font-display block">
                    Start Date
                  </label>
                  <input
                    type="date"
                    required
                    value={leaveStart}
                    onChange={(e) => setLeaveStart(e.target.value)}
                    className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-slate-800 text-xs focus:border-blue-800 focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs uppercase font-extrabold tracking-wider text-slate-400 font-display block">
                    End Date
                  </label>
                  <input
                    type="date"
                    required
                    value={leaveEnd}
                    onChange={(e) => setLeaveEnd(e.target.value)}
                    className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-slate-800 text-xs focus:border-blue-800 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase font-extrabold tracking-wider text-slate-400 font-display block">
                  Absence Reason
                </label>
                <div className="flex flex-wrap gap-2 pb-1">
                  {leaveReasonOptions.map(option => (
                    <button key={option.label} type="button" onClick={() => setLeaveReason(option.label)} className={`leave-reason-chip ${leaveReason === option.label ? "is-selected" : ""}`} aria-pressed={leaveReason === option.label}>
                      <span>{option.emoji}</span><span>{option.label}</span>
                    </button>
                  ))}
                </div>
                <textarea
                  required
                  value={leaveReason}
                  onChange={(e) => setLeaveReason(e.target.value)}
                  placeholder="Select a reason above or add custom details"
                  rows={2}
                  className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-slate-800 text-xs focus:border-blue-800 focus:outline-hidden resize-none leading-relaxed"
                />
              </div>

              <button
                type="submit"
                disabled={leaveSubmitting}
                className="w-full bg-gradient-to-r from-blue-700 to-cyan-600 hover:from-blue-800 hover:to-cyan-700 text-white font-extrabold text-xs uppercase tracking-wider py-2.5 px-4 rounded-xl shadow-xs cursor-pointer transition-all hover:shadow-lg active:scale-98 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {leaveSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                <span>Submit Request</span>
              </button>
            </form>
          </div>

          {/* Section B: Leave Requests Board (History + Approval controls) */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 soft-shadow space-y-5 hover-lift transition-all">
            <div className="relative flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-sm uppercase tracking-wider text-slate-700 font-display">Leave Requests</h3>
                <p className="text-xs text-slate-400 mt-0.5 font-medium">
                  {isManagerOrAdmin ? "Approve or reject team requests." : "Status of your leave requests."}
                </p>
              </div>
              <button type="button" aria-expanded={showLeaveLegend} onClick={() => setShowLeaveLegend(value => !value)} className="legend-trigger shrink-0"><Info className="h-4 w-4" /><span className="hidden sm:inline">Leave key</span></button>
              {showLeaveLegend && (
                <div role="dialog" aria-label="Leave status legend" className="context-legend absolute right-0 top-12 z-[60] w-[min(330px,calc(100vw-3rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl animate-dropdown-in">
                  <div className="space-y-1">
                    <div className="legend-row"><span className="legend-swatch bg-amber-500"/><span><strong>Pending</strong><small>Waiting for manager approval</small></span></div>
                    <div className="legend-row"><span className="legend-swatch bg-emerald-500"/><span><strong>Approved</strong><small>Leave has been accepted</small></span></div>
                    <div className="legend-row"><span className="legend-swatch bg-rose-500"/><span><strong>Rejected</strong><small>Leave request was declined</small></span></div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
              {leaves.map((lv) => {
                const isMyLeave = lv.userId === currentUser.id;
                // Managers see all leaves; normal employees see only theirs
                if (!isManagerOrAdmin && !isMyLeave) return null;

                return (
                  <div
                    key={lv.id}
                    className="p-4 rounded-xl border border-slate-100 bg-slate-50/70 soft-shadow space-y-2.5 text-xs flex flex-col justify-between transition-all hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <span className="font-bold text-slate-950 block">{lv.userName}</span>
                        <span className="text-xs text-slate-500 font-mono block">
                          {lv.startDate} to {lv.endDate}
                        </span>
                      </div>

                      <span className={`text-xs px-2.5 py-0.5 rounded font-black uppercase tracking-wider border ${
                        lv.status === "Approved" 
                          ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                          : lv.status === "Rejected" 
                          ? "bg-rose-50 text-rose-750 border-rose-100" 
                          : "bg-amber-50 text-amber-700 border-amber-100"
                      }`}>
                        {lv.status}
                      </span>
                    </div>

                    <p className="text-xs text-slate-650 italic">
                      "{lv.reason}"
                    </p>

                    {/* Admin Action buttons if leave request is pending */}
                    {isManagerOrAdmin && lv.status === "Pending" && (
                      <div className="flex items-center gap-2 pt-1 border-t border-slate-100 mt-1">
                        <button
                          onClick={() => handleStatusChange(lv.id, "Approved")}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase py-2 px-2 rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all hover:shadow-md active:scale-95"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Approve</span>
                        </button>
                        <button
                          onClick={() => handleStatusChange(lv.id, "Rejected")}
                          className="flex-1 bg-rose-650 hover:bg-rose-700 text-white font-extrabold text-xs uppercase py-2 px-2 rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all hover:shadow-md active:scale-95"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span>Reject</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {leaves.length === 0 || (!isManagerOrAdmin && !leaves.some(l => l.userId === currentUser.id)) ? (
                <div className="text-center py-6 text-slate-400 space-y-1">
                  <FileText className="h-6 w-6 text-slate-350 mx-auto" />
                  <p className="text-xs font-semibold">No leave requests yet.</p>
                </div>
              ) : null}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
