import { useRef, type KeyboardEvent } from "react";
import { BarChart3, ListChecks, Play, Settings2, Users } from "lucide-react";
import { cn } from "../../lib/utils";

export type ConsoleTab = "host" | "sessions" | "questions" | "reports" | "settings";

const TABS: { id: ConsoleTab; label: string; icon: typeof Play }[] = [
  { id: "host", label: "Host", icon: Play },
  { id: "sessions", label: "Sessions", icon: Users },
  { id: "questions", label: "Question Bank", icon: ListChecks },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "settings", label: "Settings & Tools", icon: Settings2 },
];

interface ConsoleTabsProps {
  active: ConsoleTab;
  onChange: (tab: ConsoleTab) => void;
  /** Small counts shown on a tab, e.g. running sessions. */
  badges?: Partial<Record<ConsoleTab, number>>;
}

/** The instructor console's sections. Arrow keys move between tabs. */
export function ConsoleTabs({ active, onChange, badges = {} }: ConsoleTabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === active);
    const next = (i + step + TABS.length) % TABS.length;
    onChange(TABS[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Instructor console"
      onKeyDown={onKeyDown}
      className="flex gap-1 p-1.5 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto"
    >
      {TABS.map((t, i) => {
        const selected = t.id === active;
        const Icon = t.icon;
        const badge = badges[t.id];
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`console-tab-${t.id}`}
            aria-selected={selected}
            aria-controls="console-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50",
              selected ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
            {t.label}
            {badge !== undefined && badge > 0 && (
              <span
                className={cn(
                  "min-w-[1.25rem] px-1.5 py-0.5 rounded-full text-[11px] font-bold leading-none",
                  selected ? "bg-white/25 text-white" : "bg-slate-100 text-slate-600",
                )}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
