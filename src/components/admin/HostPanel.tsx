import type { ReactNode } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Gauge, Play, ShieldCheck, Trophy } from "lucide-react";
import { cn } from "../../lib/utils";
import type { SoloDifficulty } from "../../lib/questions";
import { MAX_TEAMS, MIN_TEAMS } from "../../lib/gameshow";
import { CLOSE_CALL_ROUND_CHOICES } from "../../lib/closecall";
import {
  QUESTION_COUNTS,
  ROUND_CHOICES,
  TIME_CHOICES,
  type HostMode,
} from "../../lib/instructor-prefs";

const LEVELS: { id: SoloDifficulty; label: string; dot: string }[] = [
  { id: "all", label: "Mixed", dot: "bg-blue-600" },
  { id: "easy", label: "Easy", dot: "bg-teal-500" },
  { id: "medium", label: "Medium", dot: "bg-amber-500" },
  { id: "hard", label: "Hard", dot: "bg-rose-500" },
];

interface HostPanelProps {
  mode: HostMode;
  onModeChange: (mode: HostMode) => void;
  difficulty: SoloDifficulty;
  onDifficultyChange: (d: SoloDifficulty) => void;
  questionCount: number;
  onQuestionCountChange: (n: number) => void;
  timePerQuestion: number;
  onTimePerQuestionChange: (n: number) => void;
  teamCount: number;
  onTeamCountChange: (n: number) => void;
  rounds: number;
  onRoundsChange: (n: number) => void;
  closeCallRounds: number;
  onCloseCallRoundsChange: (n: number) => void;
  /** Questions in the bank at each level. */
  availability: Record<SoloDifficulty, number>;
  isHosting: boolean;
  error: string;
  onStart: () => void;
}

/** A labelled row of choices, styled like the rest of the console. */
function ChoiceGroup<T extends string | number>({
  label,
  hint,
  choices,
  value,
  onChange,
  render,
  isDisabled,
}: {
  label: string;
  hint?: string;
  choices: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render?: (v: T) => ReactNode;
  isDisabled?: (v: T) => boolean;
}) {
  const id = `host-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="space-y-2">
      <p id={id} className="text-xs font-bold text-slate-600 uppercase tracking-wider">{label}</p>
      <div role="group" aria-labelledby={id} className="inline-flex flex-wrap gap-1 p-1.5 bg-slate-100 border border-slate-200 rounded-2xl">
        {choices.map((c) => {
          const selected = c === value;
          const disabled = isDisabled?.(c) ?? false;
          return (
            <button
              key={String(c)}
              onClick={() => !disabled && onChange(c)}
              disabled={disabled}
              aria-pressed={selected}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50",
                selected
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                  : disabled
                    ? "text-slate-300 cursor-not-allowed border border-transparent"
                    : "text-slate-500 hover:text-slate-900 border border-transparent",
              )}
            >
              {render ? render(c) : c}
            </button>
          );
        })}
      </div>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * One place to set up and start a class session. The instructor picks a
 * format first, and only the settings that format uses are shown.
 */
export function HostPanel(props: HostPanelProps) {
  const {
    mode,
    onModeChange,
    difficulty,
    onDifficultyChange,
    questionCount,
    onQuestionCountChange,
    timePerQuestion,
    onTimePerQuestionChange,
    teamCount,
    onTeamCountChange,
    rounds,
    onRoundsChange,
    closeCallRounds,
    onCloseCallRoundsChange,
    availability,
    isHosting,
    error,
    onStart,
  } = props;

  const available = availability[difficulty] ?? 0;
  const levelLabel = LEVELS.find((l) => l.id === difficulty)?.label ?? "Mixed";
  const isQuiz = mode === "quiz";
  const isCloseCall = mode === "closecall";
  // Close Call has its own items, so the question bank doesn't limit it.
  const canStart = isCloseCall || available > 0;
  const shortBank = isQuiz && available > 0 && available < questionCount;
  const teamChoices = Array.from({ length: MAX_TEAMS - MIN_TEAMS + 1 }, (_, i) => MIN_TEAMS + i);

  const formats: { id: HostMode; title: string; text: string; icon: ReactNode }[] = [
    {
      id: "quiz",
      title: "Live Quiz",
      text: "Everyone answers on their own device against the clock, with a live leaderboard.",
      icon: <ShieldCheck className="w-6 h-6" aria-hidden="true" />,
    },
    {
      id: "gameshow",
      title: "Game Show",
      text: "Teams take turns spinning the wheel on the projector and answer from their devices.",
      icon: <Trophy className="w-6 h-6" aria-hidden="true" />,
    },
    {
      id: "closecall",
      title: "Close Call",
      text: "Everyone guesses a cyber number. Closest without going over wins the round.",
      icon: <Gauge className="w-6 h-6" aria-hidden="true" />,
    },
  ];
  const formatTitle = formats.find((f) => f.id === mode)?.title ?? "Live Quiz";
  const accent = (id: HostMode) =>
    id === "quiz"
      ? { card: "border-blue-500 bg-blue-50", icon: "bg-blue-100 text-blue-700" }
      : id === "gameshow"
        ? { card: "border-amber-400 bg-amber-50", icon: "bg-amber-100 text-amber-700" }
        : { card: "border-orange-500 bg-orange-50", icon: "bg-orange-100 text-orange-700" };

  const summary: [string, string][] = isCloseCall
    ? [
        ["Format", formatTitle],
        ["Rounds", String(closeCallRounds)],
        ["Scoring", "Closest without going over"],
      ]
    : [
    ["Format", formatTitle],
    ["Level", `${levelLabel} · ${available} in bank`],
    ...(isQuiz
      ? ([
          ["Questions", String(shortBank ? available : questionCount)],
          ["Time", timePerQuestion === 0 ? "Untimed" : `${timePerQuestion}s per question`],
        ] as [string, string][])
      : ([
          ["Teams", String(teamCount)],
          ["Rounds", `${rounds} (${teamCount * rounds} turns)`],
        ] as [string, string][])),
  ];

  return (
    <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
      <div className="space-y-6">
        {/* 1. Format */}
        <section aria-labelledby="host-format" className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-4">
          <h3 id="host-format" className="text-lg font-bold text-slate-900">
            <span className="text-blue-600">1.</span> Choose a format
          </h3>
          <div role="radiogroup" aria-labelledby="host-format" className="grid sm:grid-cols-3 gap-3">
            {formats.map((f) => {
              const selected = mode === f.id;
              return (
                <button
                  key={f.id}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onModeChange(f.id)}
                  className={cn(
                    "flex flex-col items-start gap-3 p-4 rounded-2xl border-2 text-left transition-all focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/40",
                    selected ? accent(f.id).card : "border-slate-200 bg-white hover:border-slate-300",
                  )}
                >
                  <div className={cn("p-3 rounded-xl shrink-0", accent(f.id).icon)}>
                    {f.icon}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">{f.title}</p>
                    <p className="text-sm text-slate-600 leading-snug mt-0.5">{f.text}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2. Settings for that format */}
        <section aria-labelledby="host-settings" className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-6">
          <h3 id="host-settings" className="text-lg font-bold text-slate-900">
            <span className="text-blue-600">2.</span> Set it up
          </h3>

          {isCloseCall ? (
            <>
              <ChoiceGroup
                label="Rounds"
                hint="One number to guess per round. There's no clock: you reveal each answer when everyone has locked in."
                choices={CLOSE_CALL_ROUND_CHOICES}
                value={closeCallRounds as (typeof CLOSE_CALL_ROUND_CHOICES)[number]}
                onChange={onCloseCallRoundsChange}
              />
              <div className="rounded-2xl bg-orange-50 border border-orange-200 p-4 text-sm text-orange-950 space-y-1">
                <p className="font-bold">How Close Call works</p>
                <p>
                  Each round asks for a number, like how many 4-digit PINs exist or which port HTTPS uses. Students lock
                  in a guess on their device. When you reveal, the closest guess <strong>without going over</strong> wins
                  1,000 points, an exact guess wins 2,000, and anyone within 10% under gets 250.
                </p>
              </div>
            </>
          ) : (
          <>
          <ChoiceGroup
            label="Difficulty"
            choices={LEVELS.map((l) => l.id)}
            value={difficulty}
            onChange={onDifficultyChange}
            isDisabled={(d) => (availability[d] ?? 0) === 0}
            render={(d) => {
              const level = LEVELS.find((l) => l.id === d)!;
              return (
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn("w-2 h-2 rounded-full", level.dot)} aria-hidden="true" />
                  {level.label}
                  <span className="font-mono text-[11px] text-slate-400">{availability[d] ?? 0}</span>
                </span>
              );
            }}
          />

          {isQuiz ? (
            <>
              <ChoiceGroup
                label="Questions"
                choices={QUESTION_COUNTS}
                value={questionCount}
                onChange={onQuestionCountChange}
              />
              {shortBank && (
                <p className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 -mt-3">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  Only {available} {levelLabel} questions in the bank, so the quiz will use all {available}.
                </p>
              )}
              <ChoiceGroup
                label="Time per question"
                hint="Untimed is an accessibility accommodation: no clock, and points don't depend on speed."
                choices={TIME_CHOICES}
                value={timePerQuestion}
                onChange={onTimePerQuestionChange}
                render={(t) => (t === 0 ? "Untimed" : `${t}s`)}
              />
            </>
          ) : (
            <>
              <ChoiceGroup label="Teams" choices={teamChoices} value={teamCount} onChange={onTeamCountChange} />
              <ChoiceGroup
                label="Rounds"
                hint="Every team gets one turn per round. There's no clock in the game show."
                choices={ROUND_CHOICES}
                value={rounds}
                onChange={onRoundsChange}
              />
            </>
          )}
          </>
          )}
        </section>
      </div>

      {/* 3. Summary and start */}
      <aside
        aria-labelledby="host-summary"
        className="lg:sticky lg:top-6 p-6 bg-slate-900 text-white rounded-3xl shadow-xl shadow-slate-900/20 space-y-5"
      >
        <h3 id="host-summary" className="text-lg font-bold">
          <span className="text-blue-300">3.</span> Start
        </h3>
        <dl className="space-y-2 text-sm">
          {summary.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-white/10 pb-2">
              <dt className="text-slate-400">{k}</dt>
              <dd className="font-semibold text-right">{v}</dd>
            </div>
          ))}
        </dl>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onStart}
          disabled={isHosting || !canStart}
          className={cn(
            "w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/50",
            isQuiz
              ? "bg-white text-slate-900 hover:bg-blue-50"
              : isCloseCall
                ? "bg-orange-400 text-black hover:bg-orange-300"
                : "bg-amber-400 text-black hover:bg-amber-300",
          )}
        >
          <Play className="w-5 h-5 fill-current" aria-hidden="true" />
          {isHosting ? "Starting…" : `Start ${formatTitle}`}
        </motion.button>
        <p className={cn("text-xs", error ? "text-rose-300 font-semibold" : "text-slate-400")} role={error ? "alert" : undefined}>
          {error || "You'll get a 6-letter code. Students enter it on the home page to join."}
        </p>
      </aside>
    </div>
  );
}
