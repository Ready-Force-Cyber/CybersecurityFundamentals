import { useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RotateCcw,
  Stethoscope,
  Upload,
  Volume2,
  VolumeX,
  XCircle,
} from "lucide-react";
import type { Question } from "../../constants";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { validateBank, validateQuestion } from "../../lib/bank-edits";
import { CONCEPTS } from "../SoloMap";

type CheckLevel = "pass" | "warn" | "fail";
interface CheckResult {
  label: string;
  level: CheckLevel;
  detail: string;
}

/** Run the health checks an instructor can act on. Exported for tests. */
export async function runSystemCheck(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Server and the instructor's copy of the bank.
  let bank: Question[] = [];
  try {
    const started = performance.now();
    const data = await api.getQuestions();
    bank = data.questions as Question[];
    results.push({
      label: "Server is reachable",
      level: "pass",
      detail: `Answered in ${Math.round(performance.now() - started)} ms.`,
    });
  } catch (e) {
    results.push({ label: "Server is reachable", level: "fail", detail: (e as Error).message });
    return results;
  }

  // 2. Sign-in still valid.
  try {
    const { sessions } = await api.listSessions();
    const running = sessions.filter((s: { status: string }) => s.status !== "finished").length;
    results.push({
      label: "Instructor sign-in is valid",
      level: "pass",
      detail: `${sessions.length} session${sessions.length === 1 ? "" : "s"} on the server, ${running} running.`,
    });
  } catch (e) {
    results.push({
      label: "Instructor sign-in is valid",
      level: "fail",
      detail: `${(e as Error).message} Sign out and sign in again.`,
    });
  }

  // 3. Students must never receive the answer key.
  try {
    const res = await fetch("/api/questions");
    const text = await res.text();
    const leaks = text.includes("correctAnswer") || text.includes('"explanation"');
    results.push({
      label: "Answer key is hidden from students",
      level: leaks ? "fail" : "pass",
      detail: leaks
        ? "The student copy of the bank includes answers. Don't run a class until this is fixed."
        : "The copy students download has no answers or explanations.",
    });
  } catch (e) {
    results.push({ label: "Answer key is hidden from students", level: "warn", detail: (e as Error).message });
  }

  // 4. Every question complete.
  const broken = bank.filter((q) => !validateQuestion(q).ok);
  results.push({
    label: "Every question is complete",
    level: broken.length ? "fail" : "pass",
    detail: broken.length
      ? `${broken.length} question${broken.length === 1 ? "" : "s"} can't be graded or shown properly: ${broken
          .slice(0, 5)
          .map((q) => q.id)
          .join(", ")}${broken.length > 5 ? "…" : ""}. Fix them in the Question Bank.`
      : `All ${bank.length} questions have options, a correct answer and an explanation.`,
  });

  // 5. Coverage: every concept at every level, and enough to avoid repeats.
  const gaps: string[] = [];
  const thin: string[] = [];
  for (const c of CONCEPTS) {
    const mine = bank.filter((q) => q.concept === c.id);
    for (const level of ["easy", "medium", "hard"] as const) {
      if (!mine.some((q) => q.difficulty === level)) gaps.push(`${c.name} (${level})`);
    }
    if (mine.length < 5) thin.push(`${c.name}: ${mine.length}`);
  }
  results.push({
    label: "Every concept has questions at every level",
    level: gaps.length ? "warn" : "pass",
    detail: gaps.length
      ? `Nothing at: ${gaps.join(", ")}. Students who pick these will find no questions.`
      : "Each of the five concepts has easy, medium and hard questions.",
  });
  results.push({
    label: "Enough questions to avoid repeats",
    level: thin.length ? "warn" : "pass",
    detail: thin.length
      ? `Fewer than 5 questions for ${thin.join("; ")}. Students will see the same ones again quickly.`
      : `${bank.length} questions in total, at least 5 per concept.`,
  });

  return results;
}

const LEVEL_ICON: Record<CheckLevel, ReactNode> = {
  pass: <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />,
  warn: <AlertTriangle className="w-5 h-5 text-amber-600" aria-hidden="true" />,
  fail: <XCircle className="w-5 h-5 text-rose-600" aria-hidden="true" />,
};
const LEVEL_TEXT: Record<CheckLevel, string> = { pass: "Pass", warn: "Check", fail: "Problem" };

function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  const id = `settings-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-4">
      <h3 id={id} className="flex items-center gap-3 text-lg font-bold text-slate-900">
        <span className="p-2 rounded-xl bg-blue-50 text-blue-600">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

interface SettingsPanelProps {
  sound: boolean;
  onSoundChange: (on: boolean) => void;
  onResetSetup: () => void;
  questions: Question[];
  onQuestionsChange: (questions: Question[]) => void;
}

export function SettingsPanel({ sound, onSoundChange, onResetSetup, questions, onQuestionsChange }: SettingsPanelProps) {
  const [setupReset, setSetupReset] = useState(false);

  // Backup and import
  const fileInput = useRef<HTMLInputElement>(null);
  const [importPlan, setImportPlan] = useState<{ name: string; questions: Question[] } | null>(null);
  const [importMessage, setImportMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [importing, setImporting] = useState(false);

  // System check
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const downloadBank = () => {
    const blob = new Blob([JSON.stringify({ questions }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ready-force-question-bank-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const readImport = async (file: File) => {
    setImportMessage(null);
    setImportPlan(null);
    try {
      const parsed = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : parsed?.questions;
      const checked = validateBank(list);
      if (!checked.ok) {
        setImportMessage({ ok: false, text: `${file.name} can't be imported. ${checked.error}` });
        return;
      }
      if (checked.value.length === 0) {
        setImportMessage({ ok: false, text: `${file.name} has no questions in it.` });
        return;
      }
      setImportPlan({ name: file.name, questions: checked.value });
    } catch {
      setImportMessage({ ok: false, text: `${file.name} isn't a question-bank file (it isn't valid JSON).` });
    }
  };

  const confirmImport = async () => {
    if (!importPlan) return;
    setImporting(true);
    try {
      const { questions: saved } = await api.replaceQuestions(importPlan.questions);
      onQuestionsChange(saved as Question[]);
      setImportMessage({ ok: true, text: `Imported ${saved.length} questions from ${importPlan.name}.` });
      setImportPlan(null);
    } catch (e) {
      setImportMessage({ ok: false, text: `Import failed. ${(e as Error).message}` });
    } finally {
      setImporting(false);
    }
  };

  const check = async () => {
    setChecking(true);
    try {
      setResults(await runSystemCheck());
      setCheckedAt(new Date());
    } finally {
      setChecking(false);
    }
  };

  const problems = results?.filter((r) => r.level !== "pass").length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-slate-900 tracking-tight">Settings &amp; tools</h3>
        <p className="text-sm text-slate-500 mt-1">
          Preferences here are saved in this browser. The tools work on the server for everyone.
        </p>
      </div>

      {/* System check first: it's the quickest way to see if anything needs attention. */}
      <Card title="System check" icon={<Stethoscope className="w-5 h-5" aria-hidden="true" />}>
        <p className="text-sm text-slate-600">
          Checks the server, your sign-in, that students can't see answers, and whether the question bank
          covers every concept and level. Run it before a class.
        </p>
        <button
          onClick={check}
          disabled={checking}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm disabled:opacity-50"
        >
          {checking ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <Stethoscope className="w-4 h-4" aria-hidden="true" />}
          {checking ? "Checking…" : results ? "Run again" : "Run system check"}
        </button>
        <div aria-live="polite">
          {results && (
            <div className="space-y-3">
              <p className={cn("text-sm font-bold", problems ? "text-amber-800" : "text-emerald-700")}>
                {problems ? `${problems} thing${problems === 1 ? "" : "s"} to look at` : "Everything looks good"}
                {checkedAt && <span className="font-normal text-slate-500"> · checked at {checkedAt.toLocaleTimeString()}</span>}
              </p>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
                {results.map((r) => (
                  <li key={r.label} className="flex items-start gap-3 p-4 bg-white">
                    {LEVEL_ICON[r.level]}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900">
                        {r.label} <span className="sr-only">: {LEVEL_TEXT[r.level]}</span>
                      </p>
                      <p className="text-sm text-slate-600">{r.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Classroom" icon={sound ? <Volume2 className="w-5 h-5" aria-hidden="true" /> : <VolumeX className="w-5 h-5" aria-hidden="true" />}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p id="sound-label" className="font-semibold text-slate-900">Sound effects</p>
              <p className="text-sm text-slate-500">Ticks, chimes and the wheel on this device.</p>
            </div>
            <button
              role="switch"
              aria-checked={sound}
              aria-labelledby="sound-label"
              onClick={() => onSoundChange(!sound)}
              className={cn(
                "relative w-12 h-7 rounded-full transition-colors shrink-0 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/40",
                sound ? "bg-blue-600" : "bg-slate-300",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform",
                  sound && "translate-x-5",
                )}
                aria-hidden="true"
              />
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-100">
            <div>
              <p className="font-semibold text-slate-900">Session setup</p>
              <p className="text-sm text-slate-500">
                Your last format, level, timing and teams are remembered for next time.
              </p>
            </div>
            <button
              onClick={() => {
                onResetSetup();
                setSetupReset(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-sm shrink-0"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" /> Reset
            </button>
          </div>
          <p aria-live="polite" className="text-xs font-semibold text-emerald-700 empty:hidden">
            {setupReset ? "Session setup is back to the standard defaults." : ""}
          </p>
        </Card>

        <Card title="Question bank backup" icon={<Download className="w-5 h-5" aria-hidden="true" />}>
          <p className="text-sm text-slate-600">
            Download the whole bank to keep a copy, or to move questions to another copy of the app. The file
            includes the answers, so keep it away from students.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={downloadBank}
              disabled={questions.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-sm disabled:opacity-50"
            >
              <Download className="w-4 h-4" aria-hidden="true" /> Download ({questions.length})
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-sm"
            >
              <Upload className="w-4 h-4" aria-hidden="true" /> Import a backup…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readImport(file);
                e.target.value = "";
              }}
            />
          </div>

          {importPlan && (
            <div role="alertdialog" aria-label="Confirm import" className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-3">
              <p className="text-sm font-semibold text-amber-900">
                Replace the current {questions.length} questions with the {importPlan.questions.length} in{" "}
                {importPlan.name}? Every question in the file passed the checks.
              </p>
              <div className="flex gap-2">
                <button onClick={confirmImport} disabled={importing} className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white font-bold rounded-xl text-sm disabled:opacity-50">
                  {importing ? "Importing…" : "Replace bank"}
                </button>
                <button onClick={() => setImportPlan(null)} className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}
          <p
            aria-live="polite"
            className={cn("text-sm font-medium empty:hidden", importMessage?.ok ? "text-emerald-700" : "text-rose-700")}
          >
            {importMessage?.text ?? ""}
          </p>
        </Card>
      </div>
    </div>
  );
}
