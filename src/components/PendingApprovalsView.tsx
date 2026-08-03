import React, { useState } from "react";
import { User } from "../types";
import { Check, Mail, ShieldAlert, UserX, Clock3 } from "lucide-react";

interface Props {
  pendingUsers: User[];
  onApprove: (userId: string) => Promise<boolean>;
  onReject: (userId: string) => Promise<boolean>;
}

export default function PendingApprovalsView({ pendingUsers, onApprove, onReject }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = async (userId: string, action: "approve" | "reject") => {
    setBusyId(userId);
    try {
      await (action === "approve" ? onApprove(userId) : onReject(userId));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 md:space-y-8 min-w-0">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-150 pb-6">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Pending Approvals</h2>
          <p className="text-xs text-slate-400 mt-1.5">Sign-ups from outside the firm's domain wait here until an Admin approves them.</p>
        </div>
        <div className="text-xs bg-amber-50 border border-amber-200 px-4 py-2 rounded-xl text-blue-900 font-bold">
          <Clock3 className="h-4 w-4 inline mr-2" />{pendingUsers.length} Waiting
        </div>
      </header>

      {!pendingUsers.length ? (
        <div className="border border-dashed border-slate-200 rounded-3xl p-12 text-center text-xs text-slate-400">
          No sign-ups are waiting for approval right now.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pendingUsers.map((user) => (
            <article key={user.id} className="soft-shadow bg-white border border-slate-200/60 rounded-3xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <span className="h-10 w-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                  {user.name?.[0]?.toUpperCase() || "?"}
                </span>
                <div className="min-w-0">
                  <h3 className="font-extrabold text-sm truncate">{user.name}</h3>
                  <p className="text-xs text-slate-400 flex items-center gap-1 truncate"><Mail className="h-3 w-3 shrink-0" />{user.email}</p>
                </div>
              </div>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />Signed up with an email outside the allowed domain.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busyId === user.id}
                  onClick={() => act(user.id, "approve")}
                  className="flex-1 rounded-full bg-gradient-to-r from-blue-700 to-cyan-600 py-2.5 text-white text-xs font-bold flex justify-center items-center gap-1.5 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />{busyId === user.id ? "Working…" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={busyId === user.id}
                  onClick={() => act(user.id, "reject")}
                  className="flex-1 rounded-full bg-slate-100 hover:bg-rose-50 hover:text-rose-700 py-2.5 text-xs font-bold flex justify-center items-center gap-1.5 disabled:opacity-50"
                >
                  <UserX className="h-3.5 w-3.5" />Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
