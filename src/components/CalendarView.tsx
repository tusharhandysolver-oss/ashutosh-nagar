import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Attendance, CalendarEvent, LeaveRequest, Task, User } from "../types";
import { Calendar, ChevronLeft, ChevronRight, Clock, Home, Info, Palmtree, Plus, UserRound, X } from "lucide-react";

interface Props {
  tasks: Task[];
  users: User[];
  events: CalendarEvent[];
  onSelectTask: (task: Task) => void;
  onCreateEvent: (event: { title: string; description: string; dueDate: string; time: string; assigneeIds: string[] }) => void;
}
const legendItems = [
  { color: "bg-amber-400", label: "Task deadline", detail: "Matter task due on this date" },
  { color: "bg-blue-600", label: "Team event", detail: "Scheduled calendar event" },
  { color: "bg-emerald-500", label: "Work from home", detail: "Remote attendance record" },
  { color: "bg-violet-500", label: "Approved leave", detail: "Approved time away" }
];

function CalendarItem({ label, tone, title, meta, description, people, alignRight, openUp, onClick, icon }: {
  label: string; tone: "amber" | "blue" | "emerald" | "violet"; title: string; meta: string;
  key?: React.Key; description?: string; people?: string; alignRight?: boolean; openUp?: boolean; onClick?: () => void; icon?: React.ReactNode;
}) {
  const tones = {
    amber: "bg-amber-50 text-amber-900 border-amber-200 before:bg-amber-400",
    blue: "bg-blue-50 text-blue-900 border-blue-200 before:bg-blue-500",
    emerald: "bg-emerald-50 text-emerald-800 border-emerald-200 before:bg-emerald-500",
    violet: "bg-violet-50 text-violet-800 border-violet-200 before:bg-violet-500"
  };
  const Tag = onClick ? "button" : "div";
  const triggerRef = useRef<HTMLElement | null>(null);
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});

  // The day cell scrolls (so a day with many entries doesn't spill into the
  // row below), which clips a plain absolutely-positioned tooltip to the
  // cell's small clip box. Portalling it out and positioning it with fixed
  // coordinates (computed from the trigger's own rect) escapes that clip.
  function showTooltip() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next: { top?: number; bottom?: number; left?: number; right?: number } = {};
    if (openUp) next.bottom = window.innerHeight - rect.top + 7;
    else next.top = rect.bottom + 7;
    if (alignRight) next.right = window.innerWidth - rect.right;
    else next.left = rect.left;
    setPos(next);
    setShow(true);
  }
  function hideTooltip() {
    setShow(false);
  }

  const portalTarget = typeof document !== "undefined" ? document.querySelector(".legal-app") || document.body : null;

  return <div className="group/event relative min-w-0" onMouseEnter={showTooltip} onMouseLeave={hideTooltip} onFocus={showTooltip} onBlur={hideTooltip}>
    <Tag ref={triggerRef as any} onClick={onClick} tabIndex={0} className={`calendar-event relative block w-full truncate rounded-lg border py-1 pl-2.5 pr-1.5 text-left text-[9px] font-bold before:absolute before:bottom-1.5 before:left-1 before:top-1.5 before:w-0.5 before:rounded-full sm:text-[10px] ${tones[tone]}`}>
      <span className="inline-flex max-w-full items-center gap-1 truncate">{icon}{label}</span>
    </Tag>
    {show && portalTarget && createPortal(
      <div role="tooltip" className="pointer-events-none fixed z-[200] w-64 rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-[0_20px_55px_-18px_rgba(15,23,42,.42)]" style={pos}>
        <div className="mb-2 flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${tone === "amber" ? "bg-amber-400" : tone === "blue" ? "bg-blue-500" : tone === "emerald" ? "bg-emerald-500" : "bg-violet-500"}`} /><span className="text-[9px] font-extrabold uppercase tracking-[.16em] text-slate-400">{title}</span></div>
        <p className="text-xs font-extrabold leading-snug text-slate-900">{label}</p>
        <div className="mt-2.5 space-y-1.5 text-[10px] leading-relaxed text-slate-500">
          <p className="flex items-start gap-1.5"><Clock className="mt-0.5 h-3 w-3 shrink-0" />{meta}</p>
          {people && <p className="flex items-start gap-1.5"><UserRound className="mt-0.5 h-3 w-3 shrink-0" />{people}</p>}
          {description && <p className="border-t border-slate-100 pt-2 text-slate-600">{description}</p>}
        </div>
        {onClick && <p className="mt-3 text-[9px] font-bold text-blue-700">Click to open task →</p>}
      </div>,
      portalTarget
    )}
  </div>;
}

export default function CalendarView({ tasks, users, events, onSelectTask, onCreateEvent }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [filterAssignee, setFilterAssignee] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [time, setTime] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);

  useEffect(() => { Promise.all([fetch("/api/attendance").then(r => r.json()), fetch("/api/leaves").then(r => r.json())]).then(([a, l]) => { setAttendance(a); setLeaves(l); }).catch(() => {}); }, []);

  const cells = useMemo(() => {
    const result: Array<string | null> = Array(new Date(year, month, 1).getDay()).fill(null);
    for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day++) result.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    while (result.length % 7) result.push(null);
    return result;
  }, [year, month]);

  const move = (delta: number) => { const next = new Date(year, month + delta, 1); setYear(next.getFullYear()); setMonth(next.getMonth()); };
  const toggleAssignee = (id: string) => setAssignees(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]);
  const addEvent = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !dueDate || !time || !assignees.length) return;
    onCreateEvent({ title: title.trim(), description: description.trim(), dueDate, time, assigneeIds: assignees });
    setTitle(""); setDescription(""); setDueDate(""); setTime(""); setAssignees([]); setShowAdd(false);
  };
  const monthName = new Date(year, month).toLocaleString("en", { month: "long" });

  return <div className="space-y-3 md:space-y-4 min-w-0">
    <header className="calendar-toolbar flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-4 py-3 sm:px-5 rounded-2xl border border-slate-200 bg-white shadow-[0_10px_35px_-28px_rgba(15,23,42,.4)]">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden sm:grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-white"><Calendar className="h-4 w-4" /></div>
        <div className="min-w-0">
          <p className="text-[9px] font-extrabold uppercase tracking-[.18em] text-slate-400">Team schedule</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <button onClick={() => move(-1)} aria-label="Previous month" className="calendar-nav-button"><ChevronLeft className="h-4 w-4" /></button>
            <h2 className="min-w-[130px] text-center font-extrabold tracking-tight text-base truncate">{monthName} {year}</h2>
            <button onClick={() => move(1)} aria-label="Next month" className="calendar-nav-button"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <select aria-label="Filter calendar by team member" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} className="min-w-0 flex-1 sm:flex-none rounded-full bg-slate-50 border px-3 sm:px-4 py-2 text-xs"><option value="">All Members</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
        <div className="relative">
          <button onClick={() => setShowLegend(value => !value)} aria-expanded={showLegend} className="legend-trigger"><Info className="h-4 w-4" />Calendar key</button>
          {showLegend && <div role="dialog" aria-label="Calendar legend" className="context-legend absolute right-0 top-12 z-[60] w-[min(340px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl animate-dropdown-in"><div className="space-y-1">{legendItems.map(item => <div key={item.label} className="legend-row"><span className={`legend-swatch ${item.color}`} /><span className="min-w-0"><strong>{item.label}</strong><small>{item.detail}</small></span></div>)}</div></div>}
        </div>
        <button onClick={() => setShowAdd(true)} className="rounded-full bg-blue-900 text-white px-3 sm:px-4 py-2 text-xs font-bold flex items-center gap-2"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Add Event</span></button>
      </div>
    </header>

    <section className="calendar-shell flex flex-col bg-white border border-slate-200 rounded-2xl lg:h-[calc(100dvh-205px)] lg:min-h-[500px] lg:max-h-[720px] shadow-[0_20px_60px_-42px_rgba(15,23,42,.45)]" aria-label={`${monthName} ${year} calendar`}>
      <div className="calendar-weekdays grid shrink-0 grid-cols-7 bg-slate-50/80 border-b text-center text-[10px] font-bold uppercase text-slate-400">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <div className="py-2.5" key={day}>{day}</div>)}</div>
      <div className="calendar-grid grid flex-1 grid-cols-7 divide-x divide-y min-h-0" style={{ gridTemplateRows: `repeat(${cells.length / 7}, minmax(0, 1fr))` }}>
        {cells.map((date, index) => <div key={index} style={{ animationDelay: `${Math.min(index, 20) * 12}ms` }} className={`calendar-day calendar-cell-enter min-h-[76px] max-h-[150px] lg:min-h-0 lg:max-h-full overflow-y-auto p-1 sm:p-1.5 space-y-0.5 min-w-0 ${date ? "bg-white" : "bg-slate-50/60"}`}>
          {date && <><span className="block text-[10px] sm:text-xs font-mono font-bold">{Number(date.slice(-2))}</span>
            {tasks.filter(task => task.dueDate.split("T")[0] === date && (!filterAssignee || task.assignedTo === filterAssignee)).map(task => <CalendarItem key={task.id} tone="amber" label={task.title} title="Task deadline" meta={`${new Date(task.dueDate).toLocaleDateString()} · ${task.status} · ${task.priority} priority`} people={users.find(user => user.id === task.assignedTo)?.name || "Unassigned"} description={task.description || "No description provided."} alignRight={index % 7 >= 5} openUp={index >= cells.length - 14} onClick={() => onSelectTask(task)} />)}
            {events.filter(item => item.dueDate === date && (!filterAssignee || item.assigneeIds.includes(filterAssignee))).map(item => <CalendarItem key={item.id} tone="blue" label={item.title} title="Team event" meta={`${item.time} · ${new Date(`${item.dueDate}T00:00:00`).toLocaleDateString()}`} people={item.assigneeIds.map(id => users.find(user => user.id === id)?.name).filter(Boolean).join(", ") || "No assignees"} description={item.description || "No additional notes."} alignRight={index % 7 >= 5} openUp={index >= cells.length - 14} />)}
            {attendance.filter(item => item.date === date && (!filterAssignee || item.userId === filterAssignee)).map(item => <CalendarItem key={item.id} tone="emerald" label={`${item.userName} · WFH`} title="Remote attendance" meta={`${item.status}${item.clockInTime ? ` · In ${new Date(item.clockInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}${item.clockOutTime ? ` · Out ${new Date(item.clockOutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`} people={item.userName} icon={<Home className="hidden h-3 w-3 sm:inline" />} alignRight={index % 7 >= 5} openUp={index >= cells.length - 14} />)}
            {leaves.filter(item => item.status === "Approved" && date >= item.startDate && date <= item.endDate && (!filterAssignee || item.userId === filterAssignee)).map(item => <CalendarItem key={item.id} tone="violet" label={`${item.userName} · Leave`} title="Approved leave" meta={`${new Date(`${item.startDate}T00:00:00`).toLocaleDateString()} – ${new Date(`${item.endDate}T00:00:00`).toLocaleDateString()} · ${item.status}`} people={item.userName} description={item.reason || "No reason provided."} icon={<Palmtree className="hidden h-3 w-3 sm:inline" />} alignRight={index % 7 >= 5} openUp={index >= cells.length - 14} />)}
          </>}
        </div>)}
      </div>
    </section>

    {showAdd && (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-3 sm:p-5 backdrop-blur-md animate-fade-in">
        <form onSubmit={addEvent} className="event-form w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-[28px] bg-white shadow-2xl animate-modal-in">
          <div className="event-form-header">
            <div className="event-form-icon"><Calendar className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><p>Team calendar</p><h3>Add a new event</h3><span>Schedule work, meetings, and important matter dates.</span></div>
            <button type="button" aria-label="Close" title="Close" onClick={() => setShowAdd(false)}><X className="h-4 w-4" /></button>
          </div>
          <div className="event-form-body">
            <div className="form-field"><label htmlFor="event-title">Event title</label><input id="event-title" required value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Client strategy meeting" /></div>
            <div className="form-field"><label htmlFor="event-description">Description <span>Optional</span></label><textarea id="event-description" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Add agenda, preparation notes, or location" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="form-field"><label htmlFor="event-date">Date</label><input id="event-date" required type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
              <div className="form-field"><label htmlFor="event-time">Time</label><input id="event-time" required type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
            </div>
            <fieldset className="assignee-fieldset"><legend>Assignees <span>Select one or more</span></legend><div>{users.map(user => <label key={user.id}><input type="checkbox" checked={assignees.includes(user.id)} onChange={() => toggleAssignee(user.id)}/><span>{user.name}</span></label>)}</div></fieldset>
          </div>
          <div className="event-form-actions"><button type="button" onClick={() => setShowAdd(false)}>Cancel</button><button type="submit"><Plus className="h-4 w-4" />Create event</button></div>
        </form>
      </div>
    )}
  </div>;
}
