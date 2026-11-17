import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import confetti from "canvas-confetti";
import { AlertTriangle, CheckCircle2, ChevronRight, LogOut, XCircle, Zap } from "lucide-react";
import { cn } from "../lib/utils";
import { audio } from "../lib/audio";
import { standardsFor } from "../lib/standards";
import type { Question } from "../constants";
import type { AnswerReveal } from "../lib/api";
import {
  WHEEL,
  BANKRUPT_PENALTY,
  createSoloGameShowState,
  soloContinue,
  spinWheel,
  applySpin,
  applyAnswer,
} from "../lib/gameshow";
import { WheelFace, nextWheelRotation } from "./Wheel";

// Solo practice as a one-player game show: spin the wheel to set what the
// next question is worth, answer it, bank the points. Same wheel and scoring
// as the class game show. The learner still attempts every question in the
// set — hazards cost points or a spin, never a question — and there is no
// countdown, so nobody is rushed through the reading.

export interface SoloHistoryEntry {
  question: Question;
  correct: boolean;
  /** Seconds from the question appearing to the answer being chosen. */
  timeTaken: number;
}

export interface SoloGameShowProps {
  /** What is being practised, e.g. "Art of Defending" or "All Topics". */
  title: string;
  /** The questions for this round, in order. Sent without their answers. */
  questions: Question[];
  /** Ask the server to grade one answer. */
  check: (questionId: string, answer: string) => Promise<AnswerReveal>;
  onFinish: (result: { score: number; history: SoloHistoryEntry[] }) => void;
  onExit: () => void;
  reducedMotion?: boolean;
}

type Stage = "idle" | "spinning" | "hazard" | "question" | "checking" | "feedback";

const SPIN_SECONDS = 2.4;

/**
 * Ref callback that focuses an element when it mounts, without scrolling.
 * (The `autoFocus` attribute scrolls the page to the element, which pushed
 * the header off-screen.) Module-level so its identity is stable and it runs
 * on mount only, not on every render.
 */
const focusQuietly = (el: HTMLElement | null) => el?.focus({ preventScroll: true });
const OPTION_KEYS = ["A", "B", "C", "D", "E", "F"];

export function SoloGameShow({
  title,
  questions: incoming,
  check,
  onFinish,
  onExit,
  reducedMotion = false,
}: SoloGameShowProps) {
  // Keep the set we started with: the bank can be refetched mid-round, which
  // would otherwise reshuffle the options under the learner.
  const [questions] = useState(() => incoming);
  const [game, setGame] = useState(createSoloGameShowState);
  const [stage, setStage] = useState<Stage>("idle");
  const [qIndex, setQIndex] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [reveal, setReveal] = useState<AnswerReveal | null>(null);
  const [awarded, setAwarded] = useState(0);
  const [setbackLoss, setSetbackLoss] = useState(0);
  /** A Setback also cancels an armed Double; say so rather than drop it silently. */
  const [setbackTookDouble, setSetbackTookDouble] = useState(false);
  const [checkError, setCheckError] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  /** Right/wrong for each question answered so far, for the progress dots. */
  const [results, setResults] = useState<boolean[]>([]);

  const root = useRef<HTMLDivElement>(null);
  const history = useRef<SoloHistoryEntry[]>([]);
  const shownAt = useRef(0);
  const landTimer = useRef<number | null>(null);
  const tickTimer = useRef<number | null>(null);

  const stopTimers = () => {
    if (landTimer.current !== null) window.clearTimeout(landTimer.current);
    if (tickTimer.current !== null) window.clearInterval(tickTimer.current);
    landTimer.current = null;
    tickTimer.current = null;
  };
  useEffect(() => stopTimers, []);

  // When it is time to spin again, bring the wheel back into view: on a small
  // screen the learner has usually scrolled down to read the explanation.
  useEffect(() => {
    if (stage !== "idle") return;
    root.current?.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
  }, [stage, reducedMotion]);

  const score = game.teams[0]?.score ?? 0;
  const question = questions[qIndex];
  const total = questions.length;
  const isLast = qIndex >= total - 1;
  const segment = game.spin;

  const spin = () => {
    if (stage !== "idle" || !question) return;
    const landed = spinWheel();
    const index = WHEEL.findIndex((s) => s.id === landed.id);
    setRotation((r) => nextWheelRotation(r, index));
    setStage("spinning");
    setConfirmLeave(false);

    const land = () => {
      stopTimers();
      if (landed.kind === "points") {
        setGame((g) => applySpin(g, landed, question.id));
        setPicked(null);
        setReveal(null);
        setCheckError(false);
        shownAt.current = Date.now();
        setStage("question");
      } else {
        if (landed.kind === "bankrupt") {
          setSetbackLoss(Math.min(score, BANKRUPT_PENALTY));
          setSetbackTookDouble(game.doubleNext);
        }
        setGame((g) => applySpin(g, landed, null));
        setStage("hazard");
      }
    };

    if (reducedMotion) {
      land();
    } else {
      tickTimer.current = window.setInterval(() => audio.playTick(), 130);
      landTimer.current = window.setTimeout(land, SPIN_SECONDS * 1000);
    }
  };

  const answer = async (option: string) => {
    if (stage !== "question" || !question) return;
    setPicked(option);
    setCheckError(false);
    setStage("checking");
    try {
      const res = await check(question.id, option);
      const next = applyAnswer(game, res.correct);
      setGame(next);
      setAwarded((next.teams[0]?.score ?? 0) - score);
      history.current.push({
        question,
        correct: res.correct,
        timeTaken: Math.max(0, Math.round((Date.now() - shownAt.current) / 1000)),
      });
      setResults((r) => [...r, res.correct]);
      setReveal(res);
      setStage("feedback");
      if (res.correct) {
        audio.playCorrect();
        if (!reducedMotion) {
          confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 }, colors: ["#22c55e", "#fbbf24", "#ffffff"] });
        }
      } else {
        audio.playIncorrect();
      }
    } catch {
      // Grading happens on the server, so it can fail (e.g. offline). Put the
      // question back exactly as it was and let the learner try again.
      setPicked(null);
      setCheckError(true);
      setStage("question");
    }
  };

  /** Move on from a hazard card or from answer feedback. */
  const proceed = () => {
    if (stage === "hazard") {
      setGame((g) => soloContinue(g, total - qIndex));
      setStage("idle");
      return;
    }
    if (stage !== "feedback") return;
    if (isLast) {
      onFinish({ score, history: history.current });
      return;
    }
    setGame((g) => soloContinue(g, total - (qIndex + 1)));
    setQIndex((i) => i + 1);
    setStage("idle");
  };

  if (total === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
        <p className="text-xl font-bold text-white">No questions here yet</p>
        <p className="text-slate-400">Pick another skill or difficulty.</p>
        <button
          onClick={onExit}
          className="px-5 py-3 rounded-xl bg-white text-black font-bold hover:bg-slate-200 transition-colors"
        >
          Back to the skills path
        </button>
      </div>
    );
  }

  const showingQuestion = stage === "question" || stage === "checking" || stage === "feedback";
  const worth = segment?.kind === "points" ? segment.value * (game.doubleNext ? 2 : 1) : 0;

  // One short line for screen readers each time the game moves on.
  const announcement =
    stage === "spinning"
      ? "Spinning the wheel."
      : stage === "hazard" && segment
        ? hazardText(segment.kind, setbackLoss, setbackTookDouble).title
        : stage === "question" && segment
          ? `The wheel landed on ${segment.label}. This question is worth ${worth} points.`
          : stage === "feedback" && reveal
            ? reveal.correct
              ? `Correct. You scored ${awarded} points. Your score is ${score}.`
              : `Not quite. The correct answer is: ${reveal.correctAnswer}. Your score is ${score}.`
            : "";

  return (
    <div ref={root} className="flex-1 flex flex-col gap-5 scroll-mt-4">
      {/* Header: what you're playing, where you are, your score */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
        {/* On a phone the title gets its own row, so it is not squeezed to
            a couple of letters by the progress and score beside it. */}
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">Solo game show</p>
          <h1 className="text-lg sm:text-xl font-extrabold text-white truncate">{title}</h1>
        </div>

        <div className="mr-auto sm:mr-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            Question {Math.min(qIndex + 1, total)} of {total}
          </p>
          <ol className="mt-1.5 flex flex-wrap gap-1.5" aria-hidden="true">
            {questions.map((q, i) => (
              <li
                key={q.id}
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  i < results.length
                    ? results[i]
                      ? "bg-emerald-400"
                      : "bg-rose-400"
                    : i === qIndex
                      ? "bg-amber-400 ring-2 ring-amber-400/30"
                      : "bg-white/15",
                )}
              />
            ))}
          </ol>
        </div>

        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Score</p>
          <motion.p
            key={score}
            initial={reducedMotion ? false : { scale: 1.25 }}
            animate={{ scale: 1 }}
            className="text-2xl font-black font-mono text-white"
          >
            {score}
          </motion.p>
        </div>

        {confirmLeave ? (
          <div className="flex items-center gap-2" role="alertdialog" aria-label="Leave this round?">
            <span className="text-xs text-slate-300">Leave this round?</span>
            <button
              onClick={() => setConfirmLeave(false)}
              autoFocus
              className="px-3 py-2 rounded-lg bg-white text-black text-xs font-bold hover:bg-slate-200 transition-colors"
            >
              Stay
            </button>
            <button
              onClick={onExit}
              className="px-3 py-2 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold hover:bg-rose-500/30 transition-colors"
            >
              Leave
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmLeave(true)}
            aria-label="Leave this round"
            title="Leave this round"
            className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <LogOut className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="flex-1 grid gap-6 lg:gap-10 lg:grid-cols-[auto_1fr] items-start">
        {/* The wheel. On small screens it shrinks out of the way once a
            question is up, so the question is not pushed below the fold. */}
        <div className="flex flex-col items-center gap-3">
          <WheelFace
            rotation={rotation}
            duration={reducedMotion ? 0 : SPIN_SECONDS}
            className={cn(
              "transition-[width] duration-300 lg:w-[300px]",
              showingQuestion ? "w-28" : "w-64 sm:w-72",
            )}
          />
          {game.doubleNext && (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 border border-amber-400/40 px-3 py-1 text-xs font-bold text-amber-300">
              <Zap className="w-3.5 h-3.5" aria-hidden="true" />
              Double armed: next question is worth 2×
            </p>
          )}
        </div>

        {/* The stage: spin prompt, hazard card, or the question */}
        <div className="min-w-0 flex flex-col gap-4">
          <AnimatePresence mode="wait" initial={false}>
            {(stage === "idle" || stage === "spinning") && (
              <motion.div
                key="spin"
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0 }}
                className="rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8 text-center space-y-5"
              >
                <div className="space-y-2">
                  <h2 className="text-2xl sm:text-3xl font-black text-white">
                    {stage === "spinning"
                      ? "Spinning…"
                      : qIndex === 0 && game.turnsTaken === 0
                        ? "Spin to start"
                        : `Spin for question ${qIndex + 1}`}
                  </h2>
                  <p className="text-slate-400 max-w-md mx-auto">
                    The wheel decides how many points your next question is worth.
                  </p>
                </div>
                <button
                  onClick={spin}
                  disabled={stage === "spinning"}
                  ref={focusQuietly}
                  className="w-full sm:w-auto sm:min-w-[260px] py-5 px-8 rounded-2xl bg-amber-400 text-black text-xl font-black hover:bg-amber-300 disabled:opacity-60 disabled:cursor-wait transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-200"
                >
                  {stage === "spinning" ? "Spinning…" : "SPIN THE WHEEL"}
                </button>
                {qIndex === 0 && game.turnsTaken === 0 && stage === "idle" && (
                  <ul className="text-left text-sm text-slate-400 max-w-md mx-auto space-y-1.5 pt-2 border-t border-white/10">
                    <li>
                      <strong className="text-slate-200">A number</strong> is what your question is worth.
                    </li>
                    <li>
                      <strong className="text-amber-300">Double</strong> makes your next question worth twice as much.
                    </li>
                    <li>
                      <strong className="text-slate-200">Setback</strong> costs {BANKRUPT_PENALTY} points.{" "}
                      <strong className="text-rose-300">Lose a Turn</strong> means spin again.
                    </li>
                    <li>You always get to try every question. Take your time; there is no clock.</li>
                  </ul>
                )}
              </motion.div>
            )}

            {stage === "hazard" && segment && (
              <motion.div
                key="hazard"
                initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reducedMotion ? undefined : { opacity: 0 }}
                className={cn(
                  "rounded-3xl border p-6 sm:p-8 text-center space-y-5",
                  segment.kind === "double"
                    ? "border-amber-400/40 bg-amber-400/10"
                    : "border-rose-400/30 bg-rose-500/10",
                )}
              >
                <div className="flex justify-center">
                  {segment.kind === "double" ? (
                    <Zap className="w-10 h-10 text-amber-300" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="w-10 h-10 text-rose-300" aria-hidden="true" />
                  )}
                </div>
                <div className="space-y-2">
                  <h2 className="text-3xl font-black text-white">{hazardText(segment.kind, setbackLoss, setbackTookDouble).title}</h2>
                  <p className="text-slate-300 max-w-md mx-auto">{hazardText(segment.kind, setbackLoss, setbackTookDouble).body}</p>
                </div>
                <button
                  onClick={proceed}
                  autoFocus
                  className="w-full sm:w-auto sm:min-w-[220px] py-4 px-8 rounded-2xl bg-white text-black text-lg font-black hover:bg-slate-200 transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
                >
                  Spin again
                </button>
              </motion.div>
            )}

            {showingQuestion && question && (
              <motion.div
                key={`q-${question.id}`}
                initial={reducedMotion ? false : { opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0 }}
                className="space-y-4"
              >
                <div className="rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-7 space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-3 py-1 rounded-full bg-amber-400 text-black text-sm font-black">
                      {segment?.kind === "points" ? `${segment.value} points` : "Question"}
                      {stage !== "feedback" && game.doubleNext ? " ×2" : ""}
                    </span>
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                      {String(question.concept ?? "").replace(/_/g, " ")} · {question.difficulty}
                    </span>
                  </div>

                  {question.imageUrl && (
                    <img
                      src={question.imageUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-full max-h-64 object-contain rounded-2xl border border-white/10 bg-black/40"
                    />
                  )}

                  <h2 className="text-xl sm:text-2xl font-bold leading-snug text-white">{question.question}</h2>

                  <div className="grid gap-3">
                    {(question.options ?? []).map((option, i) => {
                      const isCorrect = stage === "feedback" && reveal?.correctAnswer === option;
                      const isWrongPick = stage === "feedback" && picked === option && !reveal?.correct;
                      return (
                        <button
                          key={option}
                          onClick={() => void answer(option)}
                          disabled={stage !== "question"}
                          className={cn(
                            "flex items-start gap-3 w-full rounded-2xl border p-4 text-left transition-colors",
                            "focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/70",
                            stage === "question" && "border-white/10 bg-white/5 hover:border-amber-400/60 hover:bg-amber-400/5",
                            stage === "checking" &&
                              (picked === option
                                ? "border-amber-400/60 bg-amber-400/10"
                                : "border-white/10 bg-white/5 opacity-50"),
                            stage === "feedback" &&
                              (isCorrect
                                ? "border-emerald-400 bg-emerald-500/15 text-emerald-200"
                                : isWrongPick
                                  ? "border-rose-400 bg-rose-500/15 text-rose-200"
                                  : "border-white/10 bg-white/5 opacity-50"),
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-black",
                              isCorrect
                                ? "bg-emerald-400 text-black"
                                : isWrongPick
                                  ? "bg-rose-400 text-black"
                                  : "bg-white/10 text-slate-300",
                            )}
                            aria-hidden="true"
                          >
                            {isCorrect ? <CheckCircle2 className="w-4 h-4" /> : isWrongPick ? <XCircle className="w-4 h-4" /> : OPTION_KEYS[i]}
                          </span>
                          <span className="font-medium text-white/95">
                            {option}
                            {stage === "feedback" && (
                              <span className="sr-only">
                                {isCorrect ? " — correct answer" : isWrongPick ? " — your answer, incorrect" : ""}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {stage === "checking" && <p className="text-sm text-slate-400">Checking your answer…</p>}
                  {checkError && (
                    <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                      Couldn't check your answer. Check your connection and pick your answer again.
                    </p>
                  )}
                </div>

                {stage === "feedback" && reveal && (
                  <motion.div
                    initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "rounded-3xl border p-5 sm:p-6 space-y-3",
                      reveal.correct ? "border-emerald-400/40 bg-emerald-500/10" : "border-rose-400/40 bg-rose-500/10",
                    )}
                  >
                    <p className={cn("text-xl font-black", reveal.correct ? "text-emerald-300" : "text-rose-300")}>
                      {reveal.correct ? `Correct! +${awarded} points` : "Not quite — no points this time"}
                    </p>
                    {!reveal.correct && game.doubleNext && (
                      <p className="text-sm font-bold text-amber-300">Your Double is still armed for the next question.</p>
                    )}
                    {reveal.explanation && <p className="text-slate-200 leading-relaxed">{reveal.explanation}</p>}
                    <StandardsTags question={question} />
                    <button
                      onClick={proceed}
                      autoFocus
                      className={cn(
                        "mt-1 w-full py-4 rounded-2xl text-lg font-black flex items-center justify-center gap-2 transition-colors",
                        "focus:outline-none focus-visible:ring-4 focus-visible:ring-white/50",
                        reveal.correct ? "bg-emerald-400 text-black hover:bg-emerald-300" : "bg-white text-black hover:bg-slate-200",
                      )}
                    >
                      {isLast ? "See your results" : "Spin for the next question"}
                      <ChevronRight className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/** What a hazard means in solo play, in the learner's terms. */
function hazardText(
  kind: string,
  setbackLoss: number,
  tookDouble: boolean,
): { title: string; body: string } {
  if (kind === "double") {
    return { title: "Double!", body: "Your next question is worth twice the points. Spin again to see how many." };
  }
  if (kind === "bankrupt") {
    const alsoDouble = tookDouble ? " It also cancelled your Double." : "";
    return setbackLoss > 0
      ? {
          title: `Setback: −${setbackLoss} points`,
          body: `Bad luck, not a wrong answer. You can win them back on the next question.${alsoDouble}`,
        }
      : {
          title: "Setback",
          body: `It would have cost you points, but you had none to lose.${alsoDouble || " Lucky timing."}`,
        };
  }
  return { title: "Lose a Turn", body: "No question on this spin. Nothing lost; spin again." };
}

/** Framework alignment for the question just answered. */
function StandardsTags({ question }: { question: Question }) {
  const s = standardsFor(question);
  const tags = [...(s.securityPlus ?? []), ...(s.nice ?? [])];
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li key={tag} className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
          {tag}
        </li>
      ))}
    </ul>
  );
}
