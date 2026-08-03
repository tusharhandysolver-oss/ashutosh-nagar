import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Project, Task, User } from "../types";
import { AlertCircle, Briefcase, CalendarDays, CheckCircle2, ChevronDown, Clock3, Download, Edit, ExternalLink, FileText, FolderOpen, ListTodo, Plus, Search, UploadCloud, X } from "lucide-react";

type CaseInput = { name: string; description: string; clientName: string; matterCode: string; practiceArea: string; status: "Active" | "On Hold" | "Closed"; budget: number; clientEmail?: string; clientPhone?: string; googleDriveLink?: string };
interface Props {
  projects: Project[]; tasks: Task[]; users: User[];
  onAddProject: (data: CaseInput) => Promise<boolean>;
  onUpdateProject: (id: string, data: Partial<CaseInput>) => Promise<boolean>;
  onUploadDocument: (projectId: string, taskId: string, file: File) => Promise<{ ok: boolean; error?: string }>;
  onOpenDocument: (value: string) => Promise<void>;
}

const fieldClass = "w-full rounded-2xl bg-slate-50 border border-slate-200 px-4 py-2.5 text-slate-800 text-xs focus:border-blue-800 focus:bg-white focus:outline-hidden transition-all placeholder:text-slate-400 font-medium";

const documentName = (value: string) => {
  if (!value.startsWith("supabase://Documents/") && !value.startsWith("supabase://case-papers/")) return value.split("/").pop() || value;
  const encoded = value.split("#")[1];
  return encoded ? decodeURIComponent(encoded) : "Case document";
};

export default function ClientCasesView({ projects, tasks, onAddProject, onUpdateProject, onUploadDocument, onOpenDocument }: Props) {
  const [form, setForm] = useState<CaseInput>({ name: "", description: "", clientName: "", matterCode: "", practiceArea: "Litigation", status: "Active", budget: 0, clientEmail: "", clientPhone: "", googleDriveLink: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [clientMode, setClientMode] = useState<"existing" | "new">(projects.length ? "existing" : "new");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [activeCase, setActiveCase] = useState<Project | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [uploadTaskId, setUploadTaskId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const update = (key: keyof CaseInput, value: string | number) => setForm((old) => ({ ...old, [key]: value }));
  const reset = () => { setForm({ name: "", description: "", clientName: "", matterCode: "", practiceArea: "Litigation", status: "Active", budget: 0, clientEmail: "", clientPhone: "", googleDriveLink: "" }); setEditingId(null); };

  const groups = useMemo(() => {
    const term = search.toLowerCase();
    const matching = projects.filter((p) => [p.name, p.clientName, p.matterCode, p.practiceArea].some((v) => (v || "").toLowerCase().includes(term)));
    const result = matching.reduce<Record<string, { key: string; name: string; cases: Project[] }>>((all, item) => {
      const name = item.clientName?.trim() || "General Client"; const key = name.toLowerCase();
      (all[key] ||= { key, name, cases: [] }).cases.push(item); return all;
    }, {});
    return Object.values(result).sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, search]);

  const existingClients = useMemo(() => Object.values(projects.reduce<Record<string, Project>>((all, item) => {
    if (item.clientName?.trim()) all[item.clientName.trim().toLowerCase()] ||= item;
    return all;
  }, {})).sort((a, b) => (a.clientName || "").localeCompare(b.clientName || "")), [projects]);

  const selectExistingClient = (clientName: string) => {
    const client = existingClients.find((item) => item.clientName === clientName);
    setForm((old) => ({ ...old, clientName, clientEmail: client?.clientEmail || "", clientPhone: client?.clientPhone || "" }));
  };

  const addCaseForClient = (name: string) => {
    const source = projects.find((item) => item.clientName === name);
    setClientMode("existing"); setEditingId(null); setMessage(null);
    setForm({ name: "", description: "", clientName: name, matterCode: "", practiceArea: "Litigation", status: "Active", budget: 0, clientEmail: source?.clientEmail || "", clientPhone: source?.clientPhone || "", googleDriveLink: "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const edit = (item: Project) => { setClientMode("existing"); setEditingId(item.id); setForm({ name: item.name, description: item.description || "", clientName: item.clientName || "", matterCode: item.matterCode || "", practiceArea: item.practiceArea || "Litigation", status: item.status || "Active", budget: item.budget || 0, clientEmail: item.clientEmail || "", clientPhone: item.clientPhone || "", googleDriveLink: item.googleDriveLink || "" }); setMessage(null); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage(null);
    if (!form.name.trim() || !form.clientName.trim()) return setMessage({ type: "error", text: "Client name and case title are required." });
    setLoading(true); const payload = { ...form, name: form.name.trim(), clientName: form.clientName.trim(), matterCode: form.matterCode.trim() || `MC-${Math.floor(1000 + Math.random() * 9000)}` };
    const ok = editingId ? await onUpdateProject(editingId, payload) : await onAddProject(payload); setLoading(false);
    if (!ok) return setMessage({ type: "error", text: "Could not save the case. Please try again." });
    setMessage({ type: "success", text: `Case “${payload.name}” ${editingId ? "updated" : "added"}.` }); reset();
  };

  return <div className="space-y-6 md:space-y-8 min-w-0">
    <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-150 pb-6"><div><h2 className="text-xl font-extrabold text-slate-900">Clients, Cases & Tasks</h2><p className="text-xs text-slate-400 mt-1.5">One client can have multiple cases, and every case can have multiple tasks.</p></div><div className="text-xs bg-amber-50 border border-amber-200 px-4 py-2 rounded-xl text-blue-900 font-bold"><FolderOpen className="h-4 w-4 inline mr-2" />{groups.length} Clients · {projects.length} Cases</div></header>
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <aside className="lg:col-span-5 soft-shadow bg-white border border-slate-200/60 rounded-3xl p-6 h-fit space-y-5"><div><h3 className="font-bold text-xs uppercase tracking-wider text-slate-500">{editingId ? "Edit Case" : "Add Case"}</h3><p className="text-xs text-slate-400 mt-1">Choose an existing client name to add another case under that client.</p></div>
        <form onSubmit={submit} className="space-y-4">
          {message && <div className={`${message.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"} p-3 rounded-xl text-xs font-semibold flex gap-2`}>{message.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{message.text}</div>}
          {!editingId && <div className="grid grid-cols-2 rounded-2xl bg-slate-100 p-1 text-xs font-bold"><button type="button" onClick={() => setClientMode("existing")} className={`rounded-xl py-2.5 ${clientMode === "existing" ? "bg-white text-blue-900 shadow-xs" : "text-slate-500"}`}>Existing Client</button><button type="button" onClick={() => { setClientMode("new"); reset(); }} className={`rounded-xl py-2.5 ${clientMode === "new" ? "bg-white text-blue-900 shadow-xs" : "text-slate-500"}`}>New Client</button></div>}
          {clientMode === "existing" && !editingId ? <label className="block text-xs font-bold text-slate-500">Select Client *<select value={form.clientName} onChange={(e) => selectExistingClient(e.target.value)} className={`${fieldClass} mt-1.5`}><option value="">Choose a client...</option>{existingClients.map((client) => <option key={client.id} value={client.clientName}>{client.clientName}</option>)}</select><span className="block mt-1.5 text-[10px] text-slate-400">This case will be added under the selected client.</span></label> : <label className="block text-xs font-bold text-slate-500">{editingId ? "Client Name" : "New Client Name"} *<input value={form.clientName} onChange={(e) => update("clientName", e.target.value)} className={`${fieldClass} mt-1.5`} placeholder="e.g. Acme Corporation" /></label>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-500">Email<input type="email" value={form.clientEmail} onChange={(e) => update("clientEmail", e.target.value)} className={`${fieldClass} mt-1.5`} /></label><label className="text-xs font-bold text-slate-500">Phone<input value={form.clientPhone} onChange={(e) => update("clientPhone", e.target.value)} className={`${fieldClass} mt-1.5`} /></label></div>
          <label className="block text-xs font-bold text-slate-500">Case Title *<input value={form.name} onChange={(e) => update("name", e.target.value)} className={`${fieldClass} mt-1.5`} placeholder="e.g. Breach of Contract" /></label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-500">Matter Code<input value={form.matterCode} disabled title="Matter code is auto-generated" className={`${fieldClass} mt-1.5 disabled:opacity-60 disabled:cursor-not-allowed`} placeholder="Auto-generated" /></label><label className="text-xs font-bold text-slate-500">Status<select value={form.status} onChange={(e) => update("status", e.target.value)} className={`${fieldClass} mt-1.5`}><option>Active</option><option>On Hold</option><option>Closed</option></select></label></div>
          <label className="block text-xs font-bold text-slate-500">Google Drive Link<input type="url" value={form.googleDriveLink} onChange={(e) => update("googleDriveLink", e.target.value)} className={`${fieldClass} mt-1.5`} placeholder="https://drive.google.com/..." /></label>
          <label className="block text-xs font-bold text-slate-500">Description<textarea rows={4} value={form.description} onChange={(e) => update("description", e.target.value)} className={`${fieldClass} mt-1.5 resize-none`} /></label>
          <div className="flex gap-3">{editingId && <button type="button" onClick={reset} className="flex-1 rounded-full bg-slate-100 py-3 text-xs font-bold flex justify-center gap-2"><X className="h-4 w-4" />Cancel</button>}<button disabled={loading} className="flex-1 rounded-full bg-gradient-to-r from-blue-700 to-cyan-600 py-3 text-white text-xs font-bold flex justify-center gap-2 disabled:opacity-50">{editingId ? <Edit className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{loading ? "Saving…" : editingId ? "Save Case" : "Add Case"}</button></div>
        </form>
      </aside>
      <section className="lg:col-span-7 space-y-4 min-w-0"><div className="soft-shadow bg-white border border-slate-200 rounded-3xl p-4 relative"><Search className="absolute left-8 top-7 h-4 w-4 text-slate-400" /><label className="sr-only" htmlFor="case-search">Search clients and cases</label><input id="case-search" value={search} onChange={(e) => setSearch(e.target.value)} className={`${fieldClass} pl-10 rounded-full`} placeholder="Search client, case or matter code…" /></div>
        {groups.map((client) => { const open = expanded.has(client.key) || Boolean(search); const totalTasks = client.cases.reduce((n, c) => n + tasks.filter((t) => t.projectId === c.id).length, 0); return <section key={client.key} className="soft-shadow bg-white border border-slate-200 rounded-3xl overflow-hidden"><button onClick={() => setExpanded((old) => { const next = new Set(old); next.has(client.key) ? next.delete(client.key) : next.add(client.key); return next; })} className="w-full p-5 flex items-center justify-between text-left hover:bg-slate-50"><div className="flex gap-3 items-center"><span className="h-10 w-10 rounded-2xl bg-blue-900 text-white flex items-center justify-center"><Briefcase className="h-4 w-4" /></span><div><h3 className="font-extrabold text-sm">{client.name}</h3><p className="text-xs text-slate-400 mt-1">{client.cases.length} cases · {totalTasks} tasks</p></div></div><ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>
          {open && <div className="p-4 pt-0 space-y-3"><button type="button" onClick={() => addCaseForClient(client.name)} className="w-full rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-3 py-2.5 text-xs font-bold text-blue-900 hover:bg-amber-100"><Plus className="h-3.5 w-3.5 inline mr-1.5" />Add another case for {client.name}</button>{client.cases.map((item) => { const caseTasks = tasks.filter((t) => t.projectId === item.id); return <article key={item.id} role="button" tabIndex={0} onClick={() => setActiveCase(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setActiveCase(item); }} className="group cursor-pointer border border-slate-200 bg-slate-50/60 rounded-2xl p-4 min-w-0 transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:bg-white hover:shadow-lg"><div className="flex justify-between gap-3"><div className="min-w-0"><span className="text-[10px] font-mono text-slate-400 break-all">{item.matterCode}</span><h4 className="font-extrabold text-sm mt-1 break-words">{item.name}</h4></div><button onClick={(event) => { event.stopPropagation(); edit(item); }} title="Edit case" aria-label={`Edit ${item.name}`}><Edit className="h-4 w-4 text-slate-400" /></button></div>{item.description && <p className="text-xs text-slate-500 mt-2 break-words">{item.description}</p>}<div className="mt-3 pt-3 border-t border-slate-200"><p className="text-xs font-bold text-slate-600 flex gap-1.5 mb-2"><ListTodo className="h-3.5 w-3.5" />Tasks ({caseTasks.length})</p>{caseTasks.length ? <div className="space-y-1.5">{caseTasks.map((task) => <div key={task.id} className="bg-white rounded-xl px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3 text-xs min-w-0"><span className="font-semibold truncate">{task.title}</span><span className={`shrink-0 ${task.stage === "Completed" ? "text-emerald-600" : "text-blue-800"}`}>{task.stage}</span></div>)}</div> : <p className="text-xs text-slate-400">No tasks in this case yet.</p>}<p className="mt-3 text-[10px] font-bold text-blue-700 opacity-0 transition-opacity group-hover:opacity-100">Open case file →</p></div></article>})}</div>}
        </section>})}
        {!groups.length && <div className="border border-dashed border-slate-200 rounded-3xl p-12 text-center text-xs text-slate-400">No clients or cases match your search.</div>}
      </section>
    </div>

    {activeCase && createPortal((() => {
      const caseTasks = tasks.filter((task) => task.projectId === activeCase.id);
      const documents = caseTasks.flatMap((task) => (task.attachments || []).map((file) => ({ file, task: task.title })));
      const timeline = [...caseTasks].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const completedDates = caseTasks.map((task) => task.completedAt).filter(Boolean).map((date) => new Date(date!).getTime());
      const caseClosedAt = activeCase.status === "Closed" && completedDates.length ? new Date(Math.max(...completedDates)) : null;
      return <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-md animate-fade-in" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveCase(null); }}>
        <section role="dialog" aria-modal="true" aria-label={`${activeCase.name} case file`} className="case-file-dialog relative w-full max-w-5xl max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[30px] border border-white/70 bg-[#f8f7f3] shadow-[0_36px_110px_-24px_rgba(0,0,0,.65)]">
          <button onClick={() => setActiveCase(null)} aria-label="Close" title="Close" className="absolute right-4 top-4 z-50 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-500 shadow-sm hover:bg-white hover:text-slate-900 transition-all cursor-pointer"><X className="h-4 w-4" /></button>

          <div className="case-folder-stage">
            <div className="case-folder">
              <div className="case-folder-back"><span>{activeCase.matterCode || "CASE FILE"}</span></div>
              <div className="case-folder-paper"><FileText className="h-7 w-7 text-blue-900" /><p>{activeCase.clientName}</p><strong>{activeCase.name}</strong><small>Advocate case brief</small></div>
              <div className="case-folder-front"><span className="case-folder-tab">LEGAL MATTER</span><FolderOpen className="h-8 w-8" /><p>{activeCase.matterCode}</p></div>
            </div>
            <div className="case-opening-copy"><span>Opening case file</span><h2>{activeCase.name}</h2><p>{activeCase.clientName} · {activeCase.practiceArea || "Legal Matter"}</p>{activeCase.googleDriveLink && <a href={activeCase.googleDriveLink} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-700 hover:text-blue-900" onClick={(e) => e.stopPropagation()}><ExternalLink className="h-3.5 w-3.5" />Open Google Drive folder</a>}</div>
          </div>

          <div className="case-file-content grid gap-4 p-4 sm:p-6 lg:grid-cols-12">
            <div className="case-reveal case-reveal-one rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="case-section-label">Documents</p><h3 className="text-sm font-extrabold text-slate-900">Case papers</h3></div>
                <div className="flex items-center gap-2">
                  {activeCase.googleDriveLink && <a href={activeCase.googleDriveLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-100 px-3 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100"><ExternalLink className="h-3.5 w-3.5" />Google Drive</a>}
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">{documents.length} files</span>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-dashed border-blue-200 bg-blue-50/60 p-3">
                <p className="text-[10px] font-bold text-slate-600">Select the related task</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {caseTasks.map((task) => <button type="button" key={task.id} onClick={() => setUploadTaskId(task.id)} className={`max-w-full truncate rounded-full border px-3 py-1.5 text-[10px] font-bold transition-colors ${uploadTaskId === task.id ? "border-blue-800 bg-blue-800 text-white" : "border-blue-100 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-800"}`} title={task.title}>{task.title}</button>)}
                  {!caseTasks.length && <span className="text-[10px] text-slate-400">Create a task in this case before uploading a document.</span>}
                </div>
                <div className="mt-3 flex justify-end">
                  <label className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-800 px-3 py-2 text-[11px] font-bold text-white ${!uploadTaskId || uploading ? "pointer-events-none opacity-50" : ""}`}>
                    <UploadCloud className="h-3.5 w-3.5" />{uploading ? "Uploading…" : "Upload paper"}
                    <input type="file" className="sr-only" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.webp" onChange={async (event) => {
                      const file = event.target.files?.[0]; if (!file || !uploadTaskId) return;
                      setUploading(true); setUploadMessage(null);
                      const result = await onUploadDocument(activeCase.id, uploadTaskId, file);
                      setUploading(false); event.target.value = "";
                      setUploadMessage(result.ok ? { type: "success", text: "The document was securely attached to the task." } : { type: "error", text: result.error || "Upload failed." });
                    }} />
                  </label>
                </div>
                <p className="mt-2 break-words text-[9px] leading-relaxed text-slate-500">Private Supabase Storage · 5 MB maximum · only a lightweight file reference is saved in the database.</p>
                {uploadMessage && <p className={`mt-2 break-words rounded-lg px-2.5 py-2 text-[10px] font-bold leading-relaxed ${uploadMessage.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{uploadMessage.text}</p>}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {documents.length ? documents.slice(0, 6).map(({ file, task }, index) => <button type="button" onClick={() => file.startsWith("supabase://") && onOpenDocument(file).catch(() => setUploadMessage({ type: "error", text: "The document could not be opened." }))} key={`${file}-${index}`} className="case-document-card text-left" style={{ animationDelay: `${1.05 + index * .08}s` }}><span><FileText className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-slate-800">{documentName(file)}</p><small className="block truncate text-[9px] text-slate-400">{task}</small></div>{file.startsWith("supabase://") && <Download className="h-3.5 w-3.5 text-slate-400" />}</button>) : <p className="sm:col-span-2 rounded-xl bg-slate-50 p-4 text-xs text-slate-400">No documents attached yet.</p>}
              </div>
            </div>

            <div className="case-reveal case-reveal-two rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-5">
              <div className="flex items-center justify-between"><div><p className="case-section-label">Workboard</p><h3 className="text-sm font-extrabold text-slate-900">Tasks</h3></div><ListTodo className="h-4 w-4 text-slate-400" /></div>
              <div className="mt-4 space-y-2">{caseTasks.slice(0, 5).map((task, index) => <div key={task.id} className="case-task-row" style={{ animationDelay: `${1.15 + index * .08}s` }}><span className={`h-2 w-2 rounded-full ${task.stage === "Completed" ? "bg-emerald-500" : "bg-blue-500"}`} /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold text-slate-700">{task.title}</p><small className="text-[9px] text-slate-400">{task.stage} · due {new Date(task.dueDate).toLocaleDateString()}</small></div></div>)}{!caseTasks.length && <p className="text-xs text-slate-400">No tasks created yet.</p>}</div>
            </div>

            <div className="case-reveal case-reveal-three rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-12">
              <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-blue-800" /><div><p className="case-section-label">Lifecycle</p><h3 className="text-sm font-extrabold text-slate-900">Case timeline</h3></div></div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl bg-blue-50 p-3"><small className="text-[9px] font-black uppercase tracking-wider text-blue-500">Case started</small><p className="mt-1 text-xs font-bold text-slate-800">{new Date(activeCase.createdAt).toLocaleString()}</p></div>
                <div className="rounded-xl bg-slate-50 p-3"><small className="text-[9px] font-black uppercase tracking-wider text-slate-400">Case ended</small><p className="mt-1 text-xs font-bold text-slate-800">{activeCase.status !== "Closed" ? "Ongoing" : caseClosedAt ? caseClosedAt.toLocaleString() : "Closed · exact time unavailable"}</p></div>
              </div>
              <p className="mt-5 text-[9px] font-black uppercase tracking-[.16em] text-slate-400">Task milestones (each task has its own dates)</p>
              <div className="case-timeline mt-5 flex gap-0 overflow-x-auto pb-2">
                {timeline.slice(0, 6).map((task) => <div key={task.id} className="case-timeline-node"><span>{task.stage === "Completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}</span><strong>{task.title}</strong><small>{task.startedAt ? `Started ${new Date(task.startedAt).toLocaleDateString()}` : `Created ${new Date(task.createdAt).toLocaleDateString()}`}{task.completedAt ? ` · Ended ${new Date(task.completedAt).toLocaleDateString()}` : " · Ongoing"}</small></div>)}
              </div>
            </div>
          </div>
        </section>
      </div>;
    })(), document.body)}
  </div>;
}
