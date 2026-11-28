import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Lock } from "lucide-react";
import { cn } from "../lib/utils";

interface InstructorSignInProps {
  password: string;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isAuthenticating: boolean;
  /** A sign-in problem to show, e.g. a wrong password or an expired session. */
  error: string;
}

/**
 * A small "Instructor sign in" button for the top right of the home page.
 * It opens a compact sign-in box; Escape or a click elsewhere closes it.
 * Students never need it, so it stays out of their way.
 */
export function InstructorSignIn({ password, onPasswordChange, onSubmit, isAuthenticating, error }: InstructorSignInProps) {
  const still = !!useReducedMotion();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  // A sign-in problem (wrong password, expired session) opens the box so it's seen.
  useEffect(() => {
    if (error) setOpen(true);
  }, [error]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={toggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="instructor-signin"
        title="Instructor sign in"
        className={cn(
          // A 44px lock button on phones, so the app name beside it fits;
          // the full label from sm up.
          "inline-flex items-center justify-center gap-2 w-11 h-11 sm:w-auto sm:h-auto sm:px-3.5 sm:py-2 rounded-xl border text-sm font-bold shadow-sm transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300",
          open
            ? "bg-emerald-600 text-white border-emerald-600"
            : "bg-white text-slate-700 border-slate-200 hover:border-emerald-300 hover:text-emerald-700",
        )}
      >
        <Lock className="w-4 h-4" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Instructor sign in</span>
        <ChevronDown className={cn("hidden sm:block w-4 h-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id="instructor-signin"
            initial={still ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={still ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-[min(20rem,calc(100vw-2rem))] origin-top-right p-4 bg-white border border-emerald-200 rounded-2xl shadow-xl shadow-slate-900/10 z-30"
          >
            <p className="font-bold text-slate-900">Teaching a class?</p>
            <p className="text-xs text-slate-600 mt-0.5">
              Sign in to host sessions, manage the questions and see results.
            </p>
            <form onSubmit={onSubmit} className="mt-3 space-y-2.5">
              <label htmlFor="instructor-password" className="sr-only">
                Instructor password
              </label>
              <input
                ref={input}
                id="instructor-password"
                type="password"
                placeholder="Instructor password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                aria-describedby="instructor-signin-note"
                aria-invalid={error ? true : undefined}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 font-medium"
              />
              <button
                type="submit"
                disabled={isAuthenticating}
                className="w-full py-2.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300"
              >
                {isAuthenticating ? "Checking…" : "Sign in"}
              </button>
              <p
                id="instructor-signin-note"
                role={error ? "alert" : undefined}
                className={cn("text-[11px] font-medium", error ? "text-rose-600" : "text-slate-500")}
              >
                {error || "Authorized instructors only"}
              </p>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
