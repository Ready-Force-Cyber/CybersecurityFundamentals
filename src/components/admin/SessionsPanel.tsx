import { useState } from "react";
import { Trash2, Users } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SessionSummary {
  code: string;
  status: "waiting" | "started" | "finished" | string;
  difficulty: string;
  playerCount?: number;
  createdAt?: number;
  mode?: "quiz" | "gameshow";
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  waiting: { label: "Waiting", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  started: { label: "In progress", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  finished: { label: "Finished", cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

/** "5 min ago", "2 h ago", or a date for anything older than a day. */
export function timeAgo(ms: number | undefined, now = Date.now()): string {
  if (!ms || !Number.isFinite(ms)) return "Unknown";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

interface SessionsPanelProps {
  sessions: SessionSummary[];
  onDelete: (code: string) => Promise<void>;
}

/** Every session on the server, with clean-up tools. */
export function SessionsPanel({ sessions, onDelete }: SessionsPanelProps) {
  const [confirming, setConfirming] = useState<string | "finished" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const finished = sessions.filter((s) => s.status === "finished");
  const running = sessions.filter((s) => s.status !== "finished");

  const removeOne = async (code: string) => {
    setBusy(true);
    try {
      await onDelete(code);
      setMessage(`Deleted session ${code}.`);
    } catch (e) {
      setMessage(`Couldn't delete ${code}. ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const removeFinished = async () => {
    setBusy(true);
    let done = 0;
    for (const s of finished) {
      try {
        await onDelete(s.code);
        done += 1;
      } catch {
        // Keep going; the count below says how many went.
      }
    }
    setMessage(`Deleted ${done} finished session${done === 1 ? "" : "s"}.`);
    setBusy(false);
    setConfirming(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-slate-900 tracking-tight">Sessions</h3>
          <p className="text-sm text-slate-500 mt-1">
            {running.length} running · {finished.length} finished. Sessions clear themselves after a while;
            delete them here to tidy up sooner.
          </p>
        </div>
        {finished.length > 0 && (
          <button
            onClick={() => setConfirming("finished")}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-sm disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" /> Delete finished ({finished.length})
          </button>
        )}
      </div>

      <p aria-live="polite" className="text-sm font-medium text-emerald-700 empty:hidden">{message}</p>

      {confirming === "finished" && (
        <div role="alertdialog" aria-label="Confirm deleting finished sessions" className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl bg-rose-50 border border-rose-200">
          <p className="flex-1 text-sm font-semibold text-rose-900">
            Delete {finished.length} finished session{finished.length === 1 ? "" : "s"}? Their results can't be viewed afterwards.
          </p>
          <div className="flex gap-2">
            <button onClick={removeFinished} disabled={busy} autoFocus className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-sm disabled:opacity-50">
              {busy ? "Deleting…" : "Delete"}
            </button>
            <button onClick={() => setConfirming(null)} className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-3">
        {sessions.map((s) => {
          const status = STATUS_STYLE[s.status] ?? { label: s.status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
          return (
            <li key={s.code} className="p-5 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Code</p>
                  <p className="text-2xl font-bold font-mono text-blue-600 tracking-wider">{s.code}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Level</p>
                  <p className="font-bold text-slate-800 capitalize">{s.difficulty === "all" ? "Mixed" : s.difficulty}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Players</p>
                  <p className="font-bold text-slate-800 inline-flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-slate-400" aria-hidden="true" /> {s.playerCount ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Started</p>
                  <p className="font-medium text-slate-600">{timeAgo(s.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <span className={cn("px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider border", status.cls)}>
                    {status.label}
                  </span>
                  <button
                    onClick={() => setConfirming(s.code)}
                    disabled={busy}
                    className="p-2.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                    aria-label={`Delete session ${s.code}`}
                  >
                    <Trash2 className="w-5 h-5" aria-hidden="true" />
                  </button>
                </div>
              </div>
              {confirming === s.code && (
                <div role="alertdialog" aria-label={`Confirm deleting session ${s.code}`} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-2xl bg-rose-50 border border-rose-200">
                  <p className="flex-1 text-sm font-semibold text-rose-900">
                    Delete {s.code}?{s.status !== "finished" ? " Students still in it will be disconnected." : ""}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => removeOne(s.code)} disabled={busy} autoFocus className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-sm disabled:opacity-50">
                      Delete
                    </button>
                    <button onClick={() => setConfirming(null)} className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-sm">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {sessions.length === 0 && (
        <div className="p-10 text-center text-slate-500 border border-dashed border-slate-300 bg-slate-50/50 rounded-3xl">
          <p className="text-lg font-medium">No sessions yet. Start one from the Host tab.</p>
        </div>
      )}
    </div>
  );
}
