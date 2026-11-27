import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { ConceptId, Question } from "../constants";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { QUESTION_LIMITS, validateQuestion } from "../lib/bank-edits";
import { CONCEPTS } from "./SoloMap";

type Difficulty = Question["difficulty"];
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

/** The same colours the student skills map uses for each level. */
const DIFFICULTY_CHIP: Record<Difficulty, string> = {
  easy: "bg-teal-50 text-teal-800 border-teal-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  hard: "bg-rose-50 text-rose-700 border-rose-200",
};

const conceptName = (id: string) => CONCEPTS.find((c) => c.id === id)?.name ?? id;

/** What the editor form holds while an instructor types. */
interface Draft {
  /** Empty for a new question. */
  id: string;
  concept: ConceptId;
  difficulty: Difficulty;
  question: string;
  options: string[];
  /** Which option is correct, or -1 if none is marked yet. */
  correctIndex: number;
  explanation: string;
  imageUrl: string;
}

const blankDraft = (concept: ConceptId = "art_of_defending", difficulty: Difficulty = "medium"): Draft => ({
  id: "",
  concept,
  difficulty,
  question: "",
  options: ["", "", "", ""],
  correctIndex: -1,
  explanation: "",
  imageUrl: "",
});

const draftFrom = (q: Question): Draft => {
  const options = q.options?.length ? [...q.options] : ["", ""];
  return {
    id: q.id,
    concept: q.concept,
    difficulty: q.difficulty,
    question: q.question,
    options,
    correctIndex: options.indexOf(q.correctAnswer),
    explanation: q.explanation,
    imageUrl: q.imageUrl ?? "",
  };
};

/** The draft as the server expects it. Standards are kept when editing. */
const draftToQuestion = (d: Draft, original?: Question) => ({
  ...(original?.standards ? { standards: original.standards } : {}),
  id: d.id,
  concept: d.concept,
  type: "mcq" as const,
  difficulty: d.difficulty,
  question: d.question,
  options: d.options,
  correctAnswer: d.correctIndex >= 0 ? (d.options[d.correctIndex] ?? "") : "",
  explanation: d.explanation,
  imageUrl: d.imageUrl,
});

type Status = { kind: "success" | "error"; text: string } | null;

interface QuestionBankAdminProps {
  questions: Question[];
  onQuestionsChange: (questions: Question[]) => void;
}

/**
 * The instructor's question bank: see every question with its answer, add,
 * edit and remove them, and reload from the server to confirm a change stuck.
 * Every change goes to the server one question at a time, and the list then
 * shows the bank exactly as the server returned it.
 */
export function QuestionBankAdmin({ questions, onQuestionsChange }: QuestionBankAdminProps) {
  const [conceptFilter, setConceptFilter] = useState<ConceptId | "all">("all");
  const [difficultyFilter, setDifficultyFilter] = useState<Difficulty | "all">("all");
  const [search, setSearch] = useState("");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState(false);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  // The bank the admin sees must be the instructor's copy, with answers. If
  // anything here has no correct answer, it came from the student copy.
  const missingAnswers = questions.some((q) => !q.correctAnswer);

  // Bring a just-saved question into view and light it up for a moment.
  useEffect(() => {
    if (!highlightId) return;
    const el = cardRefs.current.get(highlightId);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = window.setTimeout(() => setHighlightId(null), 2600);
    return () => window.clearTimeout(t);
  }, [highlightId, questions]);

  const counts = useMemo(() => {
    const table = Object.fromEntries(
      CONCEPTS.map((c) => [c.id, { easy: 0, medium: 0, hard: 0, total: 0 }]),
    ) as Record<string, Record<Difficulty | "total", number>>;
    for (const q of questions) {
      const row = table[q.concept];
      if (!row) continue;
      row[q.difficulty] += 1;
      row.total += 1;
    }
    return table;
  }, [questions]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return questions.filter(
      (q) =>
        (conceptFilter === "all" || q.concept === conceptFilter) &&
        (difficultyFilter === "all" || q.difficulty === difficultyFilter) &&
        (!needle ||
          q.question.toLowerCase().includes(needle) ||
          q.options?.some((o) => o.toLowerCase().includes(needle)) ||
          q.explanation.toLowerCase().includes(needle)),
    );
  }, [questions, conceptFilter, difficultyFilter, search]);

  const openEditor = (next: Draft) => {
    setDraft(next);
    setPreview(false);
    setFormError("");
    setConfirmRemoveId(null);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  const closeEditor = () => {
    setDraft(null);
    setFormError("");
    setPreview(false);
  };

  const reload = async () => {
    setBusy(true);
    try {
      const data = await api.getQuestions();
      onQuestionsChange(data.questions as Question[]);
      setLastSynced(new Date());
      setStatus({ kind: "success", text: `Reloaded from the server: ${data.questions.length} questions.` });
    } catch (e) {
      setStatus({ kind: "error", text: `Couldn't reload the bank. ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    const original = draft.id ? questions.find((q) => q.id === draft.id) : undefined;
    const payload = draftToQuestion(draft, original);
    // Same rules the server applies, checked here first for a quicker answer.
    const checked = validateQuestion(payload);
    if (!checked.ok) {
      setFormError(checked.error);
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const result = draft.id
        ? await api.updateQuestion(draft.id, payload)
        : await api.addQuestion(payload);
      const saved = result.question as Question;
      onQuestionsChange(result.questions as Question[]);
      setLastSynced(new Date());
      setStatus({
        kind: "success",
        text: draft.id
          ? `Saved changes to “${saved.question}”.`
          : `Added “${saved.question}” to ${conceptName(saved.concept)} (${saved.difficulty}). The bank now has ${result.questions.length} questions.`,
      });
      // Make sure the filters don't hide the question just saved.
      if (conceptFilter !== "all" && conceptFilter !== saved.concept) setConceptFilter("all");
      if (difficultyFilter !== "all" && difficultyFilter !== saved.difficulty) setDifficultyFilter("all");
      setSearch("");
      closeEditor();
      setHighlightId(saved.id);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (q: Question) => {
    setBusy(true);
    try {
      const result = await api.deleteQuestion(q.id);
      onQuestionsChange(result.questions as Question[]);
      setLastSynced(new Date());
      setStatus({
        kind: "success",
        text: `Removed “${q.question}”. The bank now has ${result.questions.length} questions.`,
      });
      if (draft?.id === q.id) closeEditor();
    } catch (e) {
      setStatus({ kind: "error", text: `Couldn't remove that question. ${(e as Error).message}` });
    } finally {
      setBusy(false);
      setConfirmRemoveId(null);
    }
  };

  const restoreBuiltIn = async () => {
    setBusy(true);
    try {
      const { questions: restored } = await api.resetQuestions();
      onQuestionsChange(restored as Question[]);
      setLastSynced(new Date());
      setStatus({ kind: "success", text: `Restored the ${restored.length} built-in questions.` });
      closeEditor();
    } catch (e) {
      setStatus({ kind: "error", text: `Couldn't restore the built-in questions. ${(e as Error).message}` });
    } finally {
      setBusy(false);
      setConfirmRestore(false);
    }
  };

  const filtered = conceptFilter !== "all" || difficultyFilter !== "all" || search.trim() !== "";

  return (
    <div className="flex flex-col gap-6">
      {/* Header: totals and actions */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-slate-900 tracking-tight">Question bank</h3>
          <p className="text-sm text-slate-500 mt-1 max-w-xl">
            Changes save to the server straight away. They apply to solo practice and to sessions you
            start from now on. A session that's already running keeps the questions it started with.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => openEditor(blankDraft(conceptFilter === "all" ? undefined : conceptFilter, difficultyFilter === "all" ? undefined : difficultyFilter))}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors text-sm disabled:opacity-50"
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> Add question
          </button>
          <button
            onClick={reload}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl transition-colors text-sm disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", busy && "motion-safe:animate-spin")} aria-hidden="true" /> Reload from server
          </button>
          <button
            onClick={() => setConfirmRestore(true)}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl transition-colors text-sm disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" /> Restore built-in
          </button>
        </div>
      </div>

      {/* Result of the last action, read out by screen readers */}
      <div aria-live="polite" className="empty:hidden">
        {status && (
          <div
            className={cn(
              "flex items-start gap-3 p-4 rounded-2xl border text-sm font-medium",
              status.kind === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-rose-50 border-rose-200 text-rose-800",
            )}
          >
            {status.kind === "success" ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
            )}
            <p className="flex-1">
              {status.text}
              {lastSynced && status.kind === "success" && (
                <span className="block text-xs font-normal opacity-80 mt-0.5">
                  Server confirmed at {lastSynced.toLocaleTimeString()}.
                </span>
              )}
            </p>
            <button onClick={() => setStatus(null)} className="p-1 rounded-lg hover:bg-black/5" aria-label="Dismiss message">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {missingAnswers && (
        <div className="flex items-start gap-3 p-4 rounded-2xl border bg-amber-50 border-amber-200 text-amber-900 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
          <p>
            Some questions are showing without their answers, so this may be the student copy of the bank.
            Choose <strong>Reload from server</strong> before editing.
          </p>
        </div>
      )}

      {confirmRestore && (
        <div role="alertdialog" aria-labelledby="restore-title" className="p-5 rounded-2xl border-2 border-rose-200 bg-rose-50 space-y-3">
          <p id="restore-title" className="font-bold text-rose-900">Restore the built-in questions?</p>
          <p className="text-sm text-rose-800">
            This replaces the whole bank with the built-in set. Any questions you added or edited will be lost.
          </p>
          <div className="flex gap-2">
            <button
              onClick={restoreBuiltIn}
              disabled={busy}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-sm disabled:opacity-50"
            >
              Yes, restore
            </button>
            <button
              onClick={() => setConfirmRestore(false)}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Coverage: how many questions each concept has at each level */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="text-left px-5 pt-4 pb-2 text-xs font-bold uppercase tracking-widest text-slate-500">
            {questions.length} questions · pick a number to filter
          </caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-100">
              <th scope="col" className="px-5 py-2 font-bold">Concept</th>
              {DIFFICULTIES.map((d) => (
                <th key={d} scope="col" className="px-3 py-2 font-bold text-center capitalize">{d}</th>
              ))}
              <th scope="col" className="px-5 py-2 font-bold text-center">Total</th>
            </tr>
          </thead>
          <tbody>
            {CONCEPTS.map((c) => (
              <tr key={c.id} className="border-b border-slate-50 last:border-0">
                <th scope="row" className="px-5 py-2 text-left font-semibold text-slate-800">{c.name}</th>
                {DIFFICULTIES.map((d) => {
                  const n = counts[c.id]?.[d] ?? 0;
                  const active = conceptFilter === c.id && difficultyFilter === d;
                  return (
                    <td key={d} className="px-3 py-1.5 text-center">
                      <button
                        onClick={() => {
                          setConceptFilter(c.id as ConceptId);
                          setDifficultyFilter(d);
                        }}
                        aria-label={`${n} ${d} questions for ${c.name}. Show them.`}
                        className={cn(
                          "min-w-[2.5rem] px-2 py-1 rounded-lg font-mono font-bold border transition-colors",
                          active ? "bg-slate-900 text-white border-slate-900" : n === 0 ? "text-rose-600 bg-rose-50 border-rose-100 hover:border-rose-300" : cn(DIFFICULTY_CHIP[d], "hover:brightness-95"),
                        )}
                      >
                        {n}
                      </button>
                    </td>
                  );
                })}
                <td className="px-5 py-1.5 text-center">
                  <button
                    onClick={() => {
                      setConceptFilter(c.id as ConceptId);
                      setDifficultyFilter("all");
                    }}
                    aria-label={`${counts[c.id]?.total ?? 0} questions for ${c.name}. Show them.`}
                    className={cn(
                      "min-w-[2.5rem] px-2 py-1 rounded-lg font-mono font-bold border transition-colors",
                      conceptFilter === c.id && difficultyFilter === "all"
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300",
                    )}
                  >
                    {counts[c.id]?.total ?? 0}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Editor */}
      <div ref={editorRef} className="scroll-mt-6">
        <AnimatePresence initial={false}>
          {draft && (
            <motion.section
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              aria-labelledby="question-editor-title"
              className="p-6 bg-white border-2 border-blue-200 rounded-3xl shadow-xl shadow-blue-100/60 space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 id="question-editor-title" className="text-xl font-bold text-slate-900">
                  {draft.id ? "Edit question" : "Add a question"}
                </h3>
                <div className="flex bg-slate-100 p-1 rounded-xl" role="group" aria-label="Editor view">
                  <button
                    onClick={() => setPreview(false)}
                    aria-pressed={!preview}
                    className={cn("px-3 py-1.5 flex items-center gap-1.5 text-sm font-bold rounded-lg", !preview ? "bg-white text-blue-700 shadow-sm" : "text-slate-500")}
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
                  </button>
                  <button
                    onClick={() => setPreview(true)}
                    aria-pressed={preview}
                    className={cn("px-3 py-1.5 flex items-center gap-1.5 text-sm font-bold rounded-lg", preview ? "bg-white text-blue-700 shadow-sm" : "text-slate-500")}
                  >
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" /> Preview
                  </button>
                </div>
              </div>

              {!preview ? (
                <div className="space-y-5">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="qb-concept" className="text-xs font-bold text-slate-600 uppercase tracking-wider">Concept</label>
                      <select
                        id="qb-concept"
                        value={draft.concept}
                        onChange={(e) => setDraft({ ...draft, concept: e.target.value as ConceptId })}
                        className="w-full mt-1 p-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {CONCEPTS.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="qb-difficulty" className="text-xs font-bold text-slate-600 uppercase tracking-wider">Difficulty</label>
                      <select
                        id="qb-difficulty"
                        value={draft.difficulty}
                        onChange={(e) => setDraft({ ...draft, difficulty: e.target.value as Difficulty })}
                        className="w-full mt-1 p-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="qb-question" className="text-xs font-bold text-slate-600 uppercase tracking-wider">Question</label>
                    <textarea
                      id="qb-question"
                      value={draft.question}
                      maxLength={QUESTION_LIMITS.question}
                      onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                      className="w-full mt-1 p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
                    />
                  </div>

                  <fieldset>
                    <legend className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Answer options <span className="normal-case font-medium text-slate-500">(select the correct one)</span>
                    </legend>
                    <div className="mt-2 space-y-2">
                      {draft.options.map((opt, i) => {
                        const correct = draft.correctIndex === i;
                        return (
                          <div
                            key={i}
                            className={cn(
                              "flex items-center gap-3 p-2 pl-3 rounded-xl border transition-colors",
                              correct ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200",
                            )}
                          >
                            <input
                              type="radio"
                              name="qb-correct"
                              id={`qb-correct-${i}`}
                              checked={correct}
                              onChange={() => setDraft({ ...draft, correctIndex: i })}
                              className="w-4 h-4 accent-emerald-600"
                              aria-label={`Option ${i + 1} is the correct answer`}
                            />
                            <input
                              type="text"
                              value={opt}
                              maxLength={QUESTION_LIMITS.option}
                              placeholder={`Option ${i + 1}`}
                              aria-label={`Option ${i + 1}`}
                              onChange={(e) => {
                                const options = [...draft.options];
                                options[i] = e.target.value;
                                setDraft({ ...draft, options });
                              }}
                              className="flex-1 min-w-0 p-2 rounded-lg border border-transparent bg-transparent focus:outline-none focus:border-blue-300 focus:bg-white"
                            />
                            {correct && (
                              <span className="text-xs font-bold text-emerald-700 shrink-0">Correct</span>
                            )}
                            <button
                              onClick={() => {
                                const options = draft.options.filter((_, j) => j !== i);
                                const correctIndex =
                                  draft.correctIndex === i ? -1 : draft.correctIndex > i ? draft.correctIndex - 1 : draft.correctIndex;
                                setDraft({ ...draft, options, correctIndex });
                              }}
                              disabled={draft.options.length <= QUESTION_LIMITS.minOptions}
                              className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                              aria-label={`Remove option ${i + 1}`}
                            >
                              <X className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {draft.options.length < QUESTION_LIMITS.maxOptions && (
                      <button
                        onClick={() => setDraft({ ...draft, options: [...draft.options, ""] })}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-50 rounded-lg"
                      >
                        <Plus className="w-4 h-4" aria-hidden="true" /> Add option
                      </button>
                    )}
                  </fieldset>

                  <div>
                    <label htmlFor="qb-explanation" className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Explanation <span className="normal-case font-medium text-slate-500">(students see this after answering)</span>
                    </label>
                    <textarea
                      id="qb-explanation"
                      value={draft.explanation}
                      maxLength={QUESTION_LIMITS.explanation}
                      onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
                      className="w-full mt-1 p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
                    />
                  </div>

                  <div>
                    <label htmlFor="qb-image" className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Image link <span className="normal-case font-medium text-slate-500">(optional, https:// only)</span>
                    </label>
                    <input
                      id="qb-image"
                      type="url"
                      value={draft.imageUrl}
                      placeholder="https://example.com/image.png"
                      onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                      className="w-full mt-1 p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              ) : (
                <div className="bg-slate-900 text-slate-100 p-6 sm:p-8 rounded-2xl space-y-6">
                  <div className="text-center space-y-3 max-w-2xl mx-auto">
                    <span className="inline-block px-3 py-1 bg-white/10 rounded-full text-[11px] font-bold uppercase tracking-widest text-blue-200">
                      {conceptName(draft.concept)} · {draft.difficulty}
                    </span>
                    {draft.imageUrl && (
                      <img src={draft.imageUrl} alt="" className="max-h-56 mx-auto rounded-xl" referrerPolicy="no-referrer" />
                    )}
                    <p className="text-xl sm:text-2xl font-bold text-white">{draft.question || "No question text yet"}</p>
                  </div>
                  <div className="grid gap-3 max-w-xl mx-auto">
                    {draft.options.map((o, i) => (
                      <div
                        key={i}
                        className={cn(
                          "p-4 rounded-xl border",
                          draft.correctIndex === i ? "border-emerald-400 bg-emerald-400/10 text-emerald-200" : "border-white/15 text-white",
                        )}
                      >
                        {o || `Option ${i + 1}`}
                        {draft.correctIndex === i && <span className="sr-only"> (correct answer)</span>}
                      </div>
                    ))}
                  </div>
                  {draft.explanation && (
                    <p className="max-w-xl mx-auto text-sm text-slate-300">
                      <span className="font-bold text-white">Explanation: </span>
                      {draft.explanation}
                    </p>
                  )}
                </div>
              )}

              {formError && (
                <p role="alert" className="flex items-center gap-2 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> {formError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={save}
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" aria-hidden="true" /> {busy ? "Saving…" : draft.id ? "Save changes" : "Add to bank"}
                </button>
                <button
                  onClick={closeEditor}
                  className="px-4 py-2.5 bg-white text-slate-600 font-bold border border-slate-200 rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <label htmlFor="qb-search" className="sr-only">Search questions</label>
          <input
            id="qb-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions, options and explanations"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <label htmlFor="qb-filter-concept" className="sr-only">Filter by concept</label>
        <select
          id="qb-filter-concept"
          value={conceptFilter}
          onChange={(e) => setConceptFilter(e.target.value as ConceptId | "all")}
          className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
        >
          <option value="all">All concepts</option>
          {CONCEPTS.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label htmlFor="qb-filter-difficulty" className="sr-only">Filter by difficulty</label>
        <select
          id="qb-filter-difficulty"
          value={difficultyFilter}
          onChange={(e) => setDifficultyFilter(e.target.value as Difficulty | "all")}
          className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
        >
          <option value="all">All levels</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        {filtered && (
          <button
            onClick={() => {
              setConceptFilter("all");
              setDifficultyFilter("all");
              setSearch("");
            }}
            className="px-3 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-50 rounded-xl"
          >
            Clear filters
          </button>
        )}
      </div>
      <p className="text-sm text-slate-500 -mt-3" aria-live="polite">
        Showing {visible.length} of {questions.length} questions
      </p>

      {/* The questions */}
      <ul className="grid grid-cols-1 gap-4">
        {visible.map((q) => {
          const confirming = confirmRemoveId === q.id;
          return (
            <li
              key={q.id}
              ref={(el) => {
                if (el) cardRefs.current.set(q.id, el);
                else cardRefs.current.delete(q.id);
              }}
              className={cn(
                "p-5 sm:p-6 bg-white border rounded-3xl shadow-sm space-y-4 transition-all duration-500",
                highlightId === q.id ? "border-emerald-400 ring-4 ring-emerald-200" : "border-slate-200",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 font-bold text-[11px] rounded-full">
                      {conceptName(q.concept)}
                    </span>
                    <span className={cn("px-2.5 py-0.5 border font-bold text-[11px] uppercase tracking-wider rounded-full", DIFFICULTY_CHIP[q.difficulty])}>
                      {q.difficulty}
                    </span>
                    {highlightId === q.id && (
                      <span className="px-2.5 py-0.5 bg-emerald-600 text-white font-bold text-[11px] uppercase tracking-wider rounded-full">
                        Saved
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-slate-400">{q.id}</span>
                  </div>
                  <h4 className="text-lg font-bold text-slate-900">{q.question}</h4>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => openEditor(draftFrom(q))}
                    disabled={busy}
                    className="p-2 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                    aria-label={`Edit: ${q.question}`}
                  >
                    <Pencil className="w-5 h-5" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => setConfirmRemoveId(q.id)}
                    disabled={busy}
                    className="p-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    aria-label={`Remove: ${q.question}`}
                  >
                    <Trash2 className="w-5 h-5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <ul className="grid sm:grid-cols-2 gap-2">
                {q.options?.map((opt, i) => {
                  const correct = opt === q.correctAnswer;
                  return (
                    <li
                      key={i}
                      className={cn(
                        "flex items-start gap-2 px-3 py-2 text-sm rounded-lg border",
                        correct ? "bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold" : "bg-slate-50 border-slate-200 text-slate-600",
                      )}
                    >
                      {correct && <Check className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
                      <span>
                        {opt}
                        {correct && <span className="sr-only"> (correct answer)</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-sm text-slate-600">
                <span className="font-bold text-slate-800">Explanation:</span> {q.explanation}
              </p>

              {confirming && (
                <div role="alertdialog" aria-label="Confirm removal" className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl bg-rose-50 border border-rose-200">
                  <p className="flex-1 text-sm font-semibold text-rose-900">
                    Remove this question? Solo practice and new sessions won't use it any more.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => remove(q)}
                      disabled={busy}
                      autoFocus
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-sm disabled:opacity-50"
                    >
                      {busy ? "Removing…" : "Remove"}
                    </button>
                    <button
                      onClick={() => setConfirmRemoveId(null)}
                      className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {visible.length === 0 && (
        <div className="p-10 text-center text-slate-500 border border-dashed border-slate-300 bg-slate-50/50 rounded-3xl">
          <p className="text-lg font-medium">
            {questions.length === 0 ? "The bank is empty. Add a question or restore the built-in set." : "No questions match these filters."}
          </p>
        </div>
      )}
    </div>
  );
}
