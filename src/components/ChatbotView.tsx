import React, { useRef, useState } from "react";
import { Attendance, LeaveRequest, Project, Task, User } from "../types";
import { ArrowUp, Bot, CheckCircle2, Clock3, Database, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";

type Message = { role: "bot" | "user"; text: string };

const suggestions = [
  "What is today's team attendance?",
  "Which cases are currently blocked?",
  "Show this month's leave summary"
];

export default function ChatbotView({ users }: { users: User[] }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{
    role: "bot",
    text: "Hi! I am AI BOT. I can summarize live attendance, leave, and case progress records from your workspace."
  }]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function sendQuestion(rawQuestion: string) {
    const q = rawQuestion.trim();
    if (!q || loading) return;
    setMessages(m => [...m, { role: "user", text: q }]);
    setQuestion("");
    setLoading(true);
    try {
      const agentResponse = await fetch("/api/ai/ask-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q })
      });
      if (agentResponse.ok) {
        const result = await agentResponse.json();
        setMessages(m => [...m, { role: "bot", text: result.answer }]);
        return;
      }

      // Local deterministic fallback keeps core summaries available if the AI service is offline.
      const [leaves, attendance, tasks, projects]: [LeaveRequest[], Attendance[], Task[], Project[]] = await Promise.all([
        fetch("/api/leaves").then(r => r.json()),
        fetch("/api/attendance").then(r => r.json()),
        fetch("/api/tasks").then(r => r.json()),
        fetch("/api/projects").then(r => r.json())
      ]);
      const lower = q.toLowerCase();
      // Prefer the longest/most specific name match so "Tushar Bali" doesn't
      // get shadowed by a shorter unrelated "Tushar" account.
      const user = users
        .filter(u => lower.includes(u.name.toLowerCase()) || lower.includes(u.email.toLowerCase()))
        .sort((a, b) => b.name.length - a.name.length)[0];
      const targetLeaves = user ? leaves.filter(l => l.userId === user.id) : leaves;
      const targetAttendance = user ? attendance.filter(a => a.userId === user.id) : attendance;
      const targetTasks = user ? tasks.filter(t => t.assignedTo === user.id) : tasks;
      const thisMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const sessionHours = (a: Attendance) => {
        const start = new Date(a.clockInTime).getTime();
        const end = a.clockOutTime ? new Date(a.clockOutTime).getTime() : Date.now();
        return Math.max(0, (end - start) / 3_600_000);
      };
      let answer: string;

      if (lower.includes("case name") || lower.includes("cases name") || lower.includes("matter name") || lower.includes("list cases") || lower.includes("which cases")) {
        const taskProjectNames = targetTasks.map(t => t.projectName).filter(Boolean);
        const projectNames = user ? taskProjectNames : projects.map(project => project.name).filter(Boolean);
        const names = Array.from(new Set(projectNames.length ? projectNames : taskProjectNames));
        answer = names.length
          ? `Here are the exact case names (${names.length}):\n${names.map((name, index) => `${index + 1}. ${name}`).join("\n")}`
          : "No case names are available in the workspace yet.";
      } else if (lower.includes("blocked")) {
        const rows = targetTasks.filter(t => t.status === "Blocked");
        answer = rows.length ? `${rows.length} blocked case(s): ${rows.map(t => t.title).join(", ")}.` : "There are no blocked cases right now.";
      } else if (lower.includes("review")) {
        const rows = targetTasks.filter(t => t.status === "Under Review");
        answer = `${rows.length} case(s) are awaiting review${rows.length ? `: ${rows.map(t => t.title).join(", ")}` : "."}`;
      } else if (lower.includes("priority")) {
        const active = targetTasks.filter(t => t.status !== "Completed");
        const byPriority: Record<string, Task[]> = {};
        active.forEach(t => { (byPriority[t.priority] = byPriority[t.priority] || []).push(t); });
        const order = ["Critical", "High", "Medium", "Low"];
        const lines = order.filter(p => byPriority[p]?.length).map(p => `${p}: ${byPriority[p].map(t => t.title).join(", ")}`);
        answer = lines.length
          ? `${user?.name || "The team"}'s active cases by priority:\n${lines.join("\n")}`
          : `${user?.name || "The team"} has no active cases right now.`;
      } else if ((lower.includes("clock") || lower.includes("working now") || lower.includes("currently") || lower.includes("kaam kar")) && !lower.includes("leave")) {
        const openSession = targetAttendance.find(a => a.status === "Open");
        const activeTask = targetTasks.find(t => t.timerState === "running");
        answer = openSession
          ? `${user?.name || "The team member"} is currently clocked in since ${new Date(openSession.clockInTime).toLocaleTimeString()} (${openSession.type}).${activeTask ? ` Actively working on: ${activeTask.title}.` : ""}`
          : `${user?.name || "The team member"} is not currently clocked in.`;
      } else if (lower.includes("hour") || lower.includes("ghante") || lower.includes("worked")) {
        const monthRows = targetAttendance.filter(a => a.date.startsWith(thisMonth));
        const totalHours = monthRows.reduce((sum, a) => sum + sessionHours(a), 0);
        const todayRows = targetAttendance.filter(a => a.date === today);
        const todayHours = todayRows.reduce((sum, a) => sum + sessionHours(a), 0);
        answer = `${user?.name || "The team"} worked ${todayHours.toFixed(1)} hour(s) today and ${totalHours.toFixed(1)} hour(s) this month, across ${monthRows.length} attendance session(s).`;
      } else if (lower.includes("leave")) {
        const rows = targetLeaves.filter(l => l.startDate.startsWith(thisMonth));
        answer = `${user?.name || "The team"} has ${rows.length} leave request(s) this month — ${rows.filter(l => l.status === "Approved").length} approved and ${rows.filter(l => l.status === "Pending").length} pending.`;
      } else if (lower.includes("today") || lower.includes("aaj")) {
        const rows = targetAttendance.filter(a => a.date === today);
        answer = `${user?.name || "The team"} has ${rows.length} attendance record(s) today; ${rows.filter(a => a.status === "Open").length} currently clocked in.`;
      } else if (lower.includes("home") || lower.includes("wfh") || lower.includes("attendance")) {
        const rows = targetAttendance.filter(a => a.date.startsWith(thisMonth));
        answer = `${user?.name || "The team"} has ${rows.length} recorded work-from-home day(s) this month.`;
      } else {
        const active = targetTasks.filter(t => t.status !== "Completed");
        const completed = targetTasks.filter(t => t.status === "Completed");
        answer = `${user?.name || "The workspace"} has ${active.length} active case(s)${active.length ? ` (${active.map(t => t.title).join(", ")})` : ""}, ${completed.length} completed case(s), and ${targetLeaves.filter(l => l.status === "Pending").length} pending leave request(s).`;
      }
      setMessages(m => [...m, { role: "bot", text: answer }]);
    } catch {
      setMessages(m => [...m, { role: "bot", text: "Workspace data is temporarily unavailable. Please try again shortly." }]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_-35px_rgba(15,23,42,.35)]">
        <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 px-6 py-6 text-white md:px-8">
          <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-white/15 bg-white/10 backdrop-blur-xl">
                <Bot className="h-7 w-7 text-blue-200" />
                <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-blue-950 bg-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2"><h2 className="text-2xl font-extrabold">AI BOT</h2><span className="rounded-full bg-blue-400/15 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-200">Agent</span></div>
                <p className="mt-1 text-xs text-blue-200/75">Your intelligent workspace assistant</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-blue-100">
              <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5"><Database className="h-3.5 w-3.5" /> Live workspace data</span>
              <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Secure answers</span>
            </div>
          </div>
        </div>

        <div className="grid min-h-[480px] md:min-h-[560px] md:grid-cols-[220px_1fr] xl:grid-cols-[240px_1fr]">
          <aside className="hidden border-r border-slate-100 bg-slate-50/70 p-5 md:block">
            <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-slate-400">Capabilities</p>
            <div className="mt-4 space-y-2">
              {[ [Clock3, "Attendance insights"], [CheckCircle2, "Case status analysis"], [MessageSquareText, "Leave summaries"] ].map(([Icon, label]: any) => (
                <div key={label} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-600"><Icon className="h-4 w-4 text-blue-700" />{label}</div>
              ))}
            </div>
            <div className="mt-8 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-[11px] leading-relaxed text-blue-900"><Sparkles className="mb-2 h-4 w-4" />Include an employee's name in your question for a personalized summary.</div>
          </aside>

          <section className="flex min-w-0 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto p-5 md:p-7">
              {messages.map((m, i) => (
                <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "bot" && <div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-blue-950 text-white"><Bot className="h-4 w-4" /></div>}
                  <div className={`max-w-[82%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === "user" ? "rounded-br-md bg-blue-700 text-white shadow-md shadow-blue-700/15" : "rounded-bl-md border border-slate-100 bg-slate-50 text-slate-700"}`}>{m.text}</div>
                </div>
              ))}
              {loading && <div className="flex items-center gap-2 text-xs text-slate-400"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />Analyzing workspace records...</div>}
            </div>

            <div className="border-t border-slate-100 bg-white p-4 md:p-5">
              <div className="mb-3 flex flex-wrap gap-2 pb-1">
                {suggestions.map(s => <button key={s} type="button" onClick={() => sendQuestion(s)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-[11px] font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800">{s}</button>)}
              </div>
              <form onSubmit={e => { e.preventDefault(); sendQuestion(question); }} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50">
                <input ref={inputRef} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask about any user, task, comment or activity..." className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm outline-none focus:shadow-none" />
                <button disabled={!question.trim() || loading} aria-label="Send message" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-700 text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
              </form>
              <p className="mt-2 text-center text-[10px] text-slate-400">AI BOT summarizes your current workspace records. Verify critical decisions.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
