import type { ReactNode } from "react";

interface SiteHeaderProps {
  onJoinClass: () => void;
  onPracticeSolo: () => void;
  /** Shown at the right of the header: the instructor sign-in. */
  actions?: ReactNode;
}

/** Scroll to a section of the home page, respecting reduced motion. */
function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
}

/**
 * The home page header, styled to match the "About Ready Force Cyber"
 * section at the foot of the page: the logo on a white tile, the name with a
 * small teal label above, a few links into the page, and the instructor
 * sign-in on the right. It scrolls away with the page rather than floating.
 */
export function SiteHeader({ onJoinClass, onPracticeSolo, actions }: SiteHeaderProps) {
  const link =
    "px-3 py-2 rounded-lg whitespace-nowrap text-sm font-semibold text-slate-600 hover:text-slate-950 hover:bg-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50";

  return (
    <header className="flex items-center justify-between gap-4 pb-5 border-b border-slate-200">
      <a
        href="/"
        className="flex items-center gap-3 min-w-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        aria-label="Ready Force Labs home"
      >
        <span className="w-14 h-14 sm:w-[4.5rem] sm:h-[4.5rem] shrink-0 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center">
          <img src="/rfc-logo.svg" alt="" className="w-[90%] h-[90%]" />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block text-xs font-extrabold uppercase tracking-[0.1em] sm:tracking-[0.18em] text-cyan-700 truncate">
            Learn · Practice · Prove
          </span>
          <span className="block text-lg sm:text-xl font-extrabold tracking-tight text-slate-950 whitespace-nowrap">Ready Force Labs</span>
        </span>
      </a>

      <nav aria-label="Home page" className="hidden lg:flex items-center gap-1">
        <button onClick={() => scrollToId("how-it-works")} className={link}>
          How it works
        </button>
        <button onClick={onJoinClass} className={link}>
          Join a class
        </button>
        <button onClick={onPracticeSolo} className={link}>
          Practice solo
        </button>
        <button onClick={() => scrollToId("about")} className={link}>
          About
        </button>
      </nav>

      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}
