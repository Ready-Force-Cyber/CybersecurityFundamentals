import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { motion, AnimatePresence, useReducedMotion, MotionConfig } from "motion/react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Trophy,
  RotateCcw,
  Brain,
  Terminal,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Lock,
  Users,
  LogOut,
  Play,
  UserPlus,
  Trash2,
  Award,
  Zap,
  Target,
  Star,
  Map as MapIcon,
  FileCheck,
  Activity,
  KeyRound,
  Copy,
  Crown,
  Home,
  VolumeX,
} from "lucide-react";
import confetti from "canvas-confetti";
import type { Question, ConceptId } from "./constants";
import { cn } from "./lib/utils";
import { audio } from "./lib/audio";
import {
  selectSoloQuestions,
  difficultyAvailability,
  type SoloDifficulty,
} from "./lib/questions";
import { studentsToCsv, csvFilename } from "./lib/csv";
import {
  hasPassedConcept,
  getMissedQuestions,
  nextConceptId,
  CAMPAIGN_PASS_THRESHOLD,
} from "./lib/campaign";
import { learnerStandardTags, standardsCoverage } from "./lib/standards";
import { MAX_DISPLAY_NAME, looksLikeFullName } from "./lib/display-name";
import { SoloMap, CONCEPTS } from "./components/SoloMap";
import { QuestionBankAdmin } from "./components/QuestionBankAdmin";
import { HomeHero } from "./components/HomeHero";
import { InstructorSignIn } from "./components/InstructorSignIn";
import { SiteHeader } from "./components/SiteHeader";
import { WinnersPodium } from "./components/WinnersPodium";
import { lobbyMusic } from "./lib/lobby-music";
import { HostPanel } from "./components/admin/HostPanel";
import { SessionsPanel } from "./components/admin/SessionsPanel";
import { SettingsPanel } from "./components/admin/SettingsPanel";
import { ConsoleTabs, type ConsoleTab } from "./components/admin/ConsoleTabs";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type InstructorPrefs } from "./lib/instructor-prefs";
import { AboutReadyForce } from "./components/AboutReadyForce";
import { SoloGameShow } from "./components/SoloGameShow";
import { GameShowStage } from "./components/GameShowStage";
import { GameShowHost } from "./components/GameShowHost";
import { GameShowPlayer } from "./components/GameShowPlayer";
import { CloseCallHost } from "./components/CloseCallHost";
import { CloseCallPlayer } from "./components/CloseCallPlayer";
import {
  api,
  getInstructorToken,
  setInstructorToken,
  clearInstructorToken,
  type RoomState,
} from "./lib/api";

// Local identity (no Firebase). Instructors hold a server-issued token; students
// hold a server-issued player id + token for the session they joined.
interface SessionUser {
  uid: string;
  displayName: string | null;
  isAnonymous: boolean;
}

type GameState =
  | "login"
  | "lobby"
  | "waiting"
  | "hosting"
  | "playing"
  /** Student view during a game-show session (team play, no per-question timer). */
  | "gameshow_play"
  | "closecall_play"
  | "results"
  | "admin_dashboard"
  | "campaign";

// Per-session student identity, returned by the server on join.
const PLAYER_KEY = "rfc_player";

const CONCEPT_ICONS: Record<string, ReactNode> = {
  art_of_defending: <ShieldCheck className="w-5 h-5" />,
  confidentiality: <Lock className="w-5 h-5" />,
  integrity: <FileCheck className="w-5 h-5" />,
  availability: <Activity className="w-5 h-5" />,
  authentication: <KeyRound className="w-5 h-5" />,
};

interface PlayerData {
  uid: string;
  name: string;
  score: number;
  history?: { question: Question; correct: boolean; timeTaken: number }[];
}

export default function App() {
  // Honour the OS "reduce motion" setting: suppresses decorative animation,
  // confetti, and screen-transition movement for users who get motion sickness
  // or find animation distracting.
  const prefersReducedMotion = useReducedMotion();
  const [user, setUser] = useState<SessionUser | null>(null);
  const playerInfoRef = useRef<{ code: string; id: string; token: string; name: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [gameState, setGameState] = useState<GameState>("login");
  const [roomId, setRoomId] = useState("");
  const [roomData, setRoomData] = useState<any>(null);
  const [players, setPlayers] = useState<PlayerData[]>([]);
  // The question bank as this browser knows it. Students receive it without
  // `correctAnswer` / `explanation`; only a signed-in instructor receives the
  // full records. Answers reach a student one at a time, via `revealed`.
  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
  /** Answers the server has revealed, by question id — only after answering. */
  const [revealed, setRevealed] = useState<
    Record<string, { correctAnswer: string; explanation: string }>
  >({});
  /** True while playing a live quiz, where the server serves each question. */
  const [inLiveQuiz, setInLiveQuiz] = useState(false);
  /** Live quiz: the question the server is serving this player right now. */
  const [liveQuestion, setLiveQuestion] = useState<Question | null>(null);
  const [liveProgress, setLiveProgress] = useState<{ index: number; total: number } | null>(null);
  /** Live quiz: the next question could not be fetched (e.g. offline). */
  const [liveLoadError, setLiveLoadError] = useState(false);
  /** True while an answer is with the server being graded. */
  const [answerPending, setAnswerPending] = useState(false);
  /** Grading failed (e.g. offline); holds the answer so it can be retried. */
  const [answerError, setAnswerError] = useState<{ answer: string } | null>(null);
  const [adminTab, setAdminTab] = useState<ConsoleTab>("host");
  // The instructor's session setup and preferences, remembered in this browser.
  const [prefs, setPrefs] = useState<InstructorPrefs>(loadPrefs);
  const updatePrefs = (patch: Partial<InstructorPrefs>) =>
    setPrefs((current) => {
      const next = { ...current, ...patch };
      savePrefs(next);
      return next;
    });
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsData, setMetricsData] = useState<any>(null);
  const [aiSuggestions, setAiSuggestions] = useState<{title: string, description: string}[] | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(20);
  const [userAnswer, setUserAnswer] = useState("");
  const [showExplanation, setShowExplanation] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [gameHistory, setGameHistory] = useState<
    { question: Question; correct: boolean; timeTaken: number }[]
  >([]);
  const [guestName, setGuestName] = useState("");
  const [guestRoomId, setGuestRoomId] = useState("");
  const [instructorPassword, setInstructorPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [hostError, setHostError] = useState("");
  const [isHosting, setIsHosting] = useState(false);
  /** Number of teams for a game-show session. */
  const [gameShowTeamCount, setGameShowTeamCount] = useState(2);
  /** True while a spin / next-turn request is in flight. */
  const [gameShowBusy, setGameShowBusy] = useState(false);
  /** Student side: outcome of this player's last game-show answer. */
  const [gameShowResult, setGameShowResult] = useState<{ correct: boolean; correctAnswer: string } | null>(null);
  /** Question id this student's team has already answered. */
  const [answeredQuestionId, setAnsweredQuestionId] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [sessionTimeLeft, setSessionTimeLeft] = useState<number | null>(null);
  const [allRooms, setAllRooms] = useState<any[]>([]);
  const [confirmExit, setConfirmExit] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Campaign State
  const [unlockedConcepts, setUnlockedConcepts] = useState<string[]>(() => {
    const saved = localStorage.getItem("rfc_unlocked_concepts");
    return saved ? JSON.parse(saved) : ['art_of_defending'];
  });
  const [completedConcepts, setCompletedConcepts] = useState<string[]>(() => {
    const saved = localStorage.getItem("rfc_completed_concepts");
    return saved ? JSON.parse(saved) : [];
  });
  const [activeCampaignConcept, setActiveCampaignConcept] = useState<string | null>(null);
  // When set, the next round replays only these (previously missed) questions.
  const [retryQuestions, setRetryQuestions] = useState<Question[] | null>(null);
  // Solo practice settings, independent of the hosted-session difficulty.
  const [soloDifficulty, setSoloDifficulty] = useState<SoloDifficulty>("all");
  // True while playing an all-topics round rather than a single skill.
  const [soloAllTopics, setSoloAllTopics] = useState(false);

  useEffect(() => {
    localStorage.setItem("rfc_unlocked_concepts", JSON.stringify(unlockedConcepts));
    localStorage.setItem("rfc_completed_concepts", JSON.stringify(completedConcepts));
  }, [unlockedConcepts, completedConcepts]);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState<
    "all" | "easy" | "medium" | "hard"
  >("all");
  const [sessionDurationMinutes, setSessionDurationMinutes] =
    useState<number>(5);
  const [numberOfQuestions, setNumberOfQuestions] = useState<number>(10);
  const [timePerQuestion, setTimePerQuestion] = useState<number>(20);

  // A per-question limit of 0 means "untimed" — the extended-time
  // accommodation. Note the `??`: `||` would treat 0 as missing and silently
  // fall back to a timed value.
  const activeTimePerQuestion = roomData?.timePerQuestion ?? timePerQuestion;

  /** Game shows the host runs turn by turn, with no session clock. */
  const hostPacedMode = roomData?.mode === "gameshow" || roomData?.mode === "closecall";

  /** Screens that show the game-show stage rather than the cyber background. */
  const isGameShowScreen =
    (gameState === "playing" && !inLiveQuiz) ||
    gameState === "gameshow_play" ||
    gameState === "closecall_play" ||
    (gameState === "hosting" && hostPacedMode && roomData?.status === "started");
  const isUntimed = activeTimePerQuestion === 0;

  const filteredQuestions = useMemo(() => {
    // A retry round replays only the questions the learner missed.
    if (retryQuestions && retryQuestions.length > 0) return retryQuestions;

    // Solo practice: a single skill, or an all-topics round. Difficulty is
    // applied on top of either.
    if (
      (gameState === "campaign" || activeCampaignConcept || soloAllTopics) &&
      bankQuestions.length > 0
    ) {
      const soloQuestions = selectSoloQuestions(bankQuestions, {
        conceptId: soloAllTopics ? null : activeCampaignConcept,
        difficulty: soloDifficulty,
        limit: soloAllTopics ? 10 : undefined,
      });
      if (soloQuestions.length > 0) return soloQuestions;
    }

    const questions =
      difficultyFilter === "all"
        ? [...bankQuestions]
        : bankQuestions.filter((q) => q.difficulty === difficultyFilter);

    if (roomId) {
      let seed = 0;
      for (let i = 0; i < roomId.length; i++) {
        seed += roomId.charCodeAt(i);
      }
      const random = () => {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
      };

      for (let i = questions.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [questions[i], questions[j]] = [questions[j], questions[i]];
      }
    } else {
      // Basic random shuffle for local/no room yet
      for (let i = questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questions[i], questions[j]] = [questions[j], questions[i]];
      }
    }

    // Use room's question count if available, otherwise local config
    const targetCount = roomData?.questionCount || numberOfQuestions;
    return questions.slice(0, targetCount);
    // gameState and activeCampaignConcept are read above, so they must be
    // dependencies — without them, selecting a campaign concept returned the
    // previously memoised (non-campaign) question list.
  }, [
    difficultyFilter,
    roomId,
    roomData?.questionCount,
    numberOfQuestions,
    bankQuestions,
    gameState,
    activeCampaignConcept,
    retryQuestions,
    soloAllTopics,
    soloDifficulty,
  ]);

  // In a live quiz the server decides the question; otherwise it comes from
  // the local list. Either way the answer key is merged in only once the
  // server has revealed it for this question.
  const baseQuestion: Question | undefined = inLiveQuiz
    ? (liveQuestion ?? undefined)
    : filteredQuestions[currentQuestionIndex];
  const currentQuestion: Question | undefined = baseQuestion
    ? { ...baseQuestion, ...(revealed[baseQuestion.id] ?? {}) }
    : undefined;

  // Restore an instructor session (if the token is still in sessionStorage).
  useEffect(() => {
    if (getInstructorToken()) {
      setIsAdmin(true);
      setUser({ uid: "instructor", displayName: "Instructor", isAnonymous: false });
      setGameState("lobby");
    }
  }, []);

  // A student's phone may reload the page, e.g. after they switch apps. Their
  // player details are kept for this tab, so put them back in their game.
  useEffect(() => {
    if (getInstructorToken()) return;
    let saved: { code: string; id: string; token: string; name: string } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(PLAYER_KEY) || "null");
    } catch {
      saved = null;
    }
    if (!saved?.code || !saved.id || !saved.token) return;
    let cancelled = false;
    api
      .getRoom(saved.code)
      .then((room) => {
        if (cancelled) return;
        const stillPlaying = room.status !== "finished" && room.players.some((p) => p.id === saved!.id);
        if (!stillPlaying) {
          sessionStorage.removeItem(PLAYER_KEY);
          return;
        }
        playerInfoRef.current = saved;
        setGuestName(saved!.name);
        setUser({ uid: saved!.id, displayName: saved!.name, isAnonymous: true });
        setRoomData(room);
        setRoomId(saved!.code);
        // The waiting screen sends them on to whatever game is running.
        setGameState("waiting");
      })
      .catch(() => sessionStorage.removeItem(PLAYER_KEY));
    return () => {
      cancelled = true;
    };
  }, []);

  // Room polling — replaces the Firestore room + players listeners. Both the
  // host and students poll the same server endpoint for live state.
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const data: RoomState = await api.getRoom(roomId);
        if (cancelled) return;
        setRoomData(data);
        setPlayers(
          data.players.map((p) => ({ uid: p.id, name: p.name, score: p.score })) as PlayerData[],
        );
        if (data.difficulty) {
          setDifficultyFilter(data.difficulty as "all" | "easy" | "medium" | "hard");
        }
        // Host ended the session before a waiting student started — release them.
        if (data.status === "finished" && gameState === "waiting") {
          setGameState("results");
        }
      } catch (err: any) {
        if (cancelled) return;
        // 404 → room was deleted/expired. Send everyone but the host home.
        if (err?.status === 404 && gameState !== "lobby" && gameState !== "login" && gameState !== "hosting") {
          // Forget everything about the old session, or its "started" status
          // would start a countdown the moment this student joins another.
          sessionStorage.removeItem(PLAYER_KEY);
          playerInfoRef.current = null;
          setRoomData(null);
          setPlayers([]);
          setCountdown(null);
          setRoomId("");
          setGameState(user?.isAnonymous ? "login" : "lobby");
        }
      }
    };

    poll();
    const interval = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [roomId, gameState, user?.isAnonymous]);

  useEffect(() => {
    audio.setEnabled(prefs.sound);
  }, [prefs.sound]);

  // Waiting-room music: on the host's screen while students are joining. It
  // fades out when the session begins, is cancelled, or the host leaves.
  const hostWaiting = gameState === "hosting" && !!roomId && roomData?.status === "waiting";
  useEffect(() => {
    if (hostWaiting && prefs.lobbyMusic) lobbyMusic.start();
    else lobbyMusic.stop();
  }, [hostWaiting, prefs.lobbyMusic]);
  useEffect(() => () => lobbyMusic.stop(), []);

  // Question bank — fetched from the server (seeded from the built-in set).
  // Fetched again when an instructor signs in or out: students get a copy
  // without answers, the instructor gets the full bank to edit. Editing the
  // student copy would save a bank with every answer missing.
  useEffect(() => {
    let cancelled = false;
    api
      .getQuestions()
      .then((data) => {
        if (cancelled || !Array.isArray(data.questions)) return;
        setBankQuestions(data.questions as Question[]);
      })
      .catch(() => {
        // Keep whatever is already loaded. There is no built-in copy in the
        // browser to fall back to — it would ship the answer key to students.
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // Admin dashboard — poll the list of active sessions.
  useEffect(() => {
    if (gameState !== "lobby" || !isAdmin) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await api.listSessions();
        if (!cancelled) setAllRooms(data.sessions.map((s: any) => ({ id: s.code, ...s })));
      } catch (e) {
        console.error("Error fetching sessions:", e);
      }
    };
    poll();
    // Quick updates while the instructor watches the list; slower otherwise,
    // just to keep the tab's count current.
    const interval = setInterval(poll, adminTab === "sessions" ? 2500 : 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [gameState, isAdmin, adminTab]);

  useEffect(() => {
    if (
      gameState === "waiting" &&
      roomData?.status === "started" &&
      countdown === null
    ) {
      setCountdown(3);
      audio.playStart();
      let count = 3;
      const interval = setInterval(() => {
        count -= 1;
        if (count > 0) {
          setCountdown(count);
          audio.playTick();
        } else {
          clearInterval(interval);
          setCountdown(null);
          // Game-show sessions are host-paced with no per-question timer, so
          // students go to the team view rather than the solo quiz loop.
          if (roomData?.mode === "gameshow") {
            setGameState("gameshow_play");
          } else if (roomData?.mode === "closecall") {
            setGameState("closecall_play");
          } else {
            startGameLocally();
          }
        }
      }, 1000);
      return () => {
        clearInterval(interval);
        // If the countdown is interrupted (the status changed under it), reset
        // it so the next real start can run it again instead of freezing.
        setCountdown(null);
      };
    }
  }, [roomData?.status, gameState]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if ((gameState === "playing" || gameState === "hosting") && roomData?.endTime) {
      interval = setInterval(() => {
        const remaining = Math.max(
          0,
          Math.floor((roomData.endTime - Date.now()) / 1000),
        );
        setSessionTimeLeft(remaining);

        if (remaining === 0) {
          // Students advance to their results; the host stays on the monitor
          // to review the final leaderboard.
          if (gameState === "playing") {
            setGameState("results");
            audio.playEnd();
          }
          clearInterval(interval);
        }
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [gameState, roomData?.endTime]);

  const handleLogin = async (e: any) => {
    e.preventDefault();
    if (!instructorPassword) return;
    setIsAuthenticating(true);
    setLoginError("");
    try {
      const { token } = await api.login(instructorPassword);
      setInstructorToken(token);
      setInstructorPassword("");
      setIsAdmin(true);
      setUser({ uid: "instructor", displayName: "Instructor", isAnonymous: false });
      setGameState("lobby");
    } catch (error: any) {
      if (error?.status === 429) {
        setLoginError("Too many attempts. Please wait a moment and try again.");
      } else if (error?.status === 401) {
        setLoginError("Incorrect password. Please try again.");
      } else {
        setLoginError("Could not reach the server. Please try again.");
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = () => {
    clearInstructorToken();
    sessionStorage.removeItem(PLAYER_KEY);
    playerInfoRef.current = null;
    setIsAdmin(false);
    setUser(null);
    setRoomId("");
    setRoomData(null);
    setGameState("login");
  };

  const handleGuestJoin = async (e: any) => {
    e.preventDefault();
    if (!guestName || !guestRoomId) return;
    setIsAuthenticating(true);
    setJoinError("");
    try {
      const code = guestRoomId.toUpperCase();
      // Never carry another session's state into this one.
      setRoomData(null);
      setPlayers([]);
      setCountdown(null);
      const { playerId, playerToken } = await api.joinSession(code, guestName);
      const info = { code, id: playerId, token: playerToken, name: guestName };
      playerInfoRef.current = info;
      sessionStorage.setItem(PLAYER_KEY, JSON.stringify(info));
      setUser({ uid: playerId, displayName: guestName, isAnonymous: true });
      setRoomId(code);
      setGameState("waiting");
    } catch (error: any) {
      setJoinError(error?.message || "Could not join. Check the code and try again.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const createRoom = async () => {
    if (!isAdmin || isHosting) return;
    setHostError("");
    setIsHosting(true);
    // The hosting screens read these, so match them to what's being started.
    setDifficultyFilter(prefs.difficulty);
    setNumberOfQuestions(prefs.questionCount);
    setTimePerQuestion(prefs.timePerQuestion);
    setGameShowTeamCount(prefs.teamCount);
    try {
      const { code } = await api.createSession({
        difficulty: prefs.difficulty,
        // Close Call's "questions" are its rounds.
        questionCount: prefs.mode === "closecall" ? prefs.closeCallRounds : prefs.questionCount,
        timePerQuestion: prefs.timePerQuestion,
        hostName: user?.displayName || "Instructor",
        mode: prefs.mode,
        teamCount: prefs.teamCount,
        rounds: prefs.rounds,
      });
      // The host monitors the session; they do not join as a player.
      setRoomId(code);
      setRoomData(null);
      setPlayers([]);
      setSessionTimeLeft(null);
      setGameState("hosting");
    } catch (error: any) {
      console.error("Failed to create session:", error);
      if (error?.status === 401) {
        // Token expired/invalid — send the instructor back to sign in.
        clearInstructorToken();
        setIsAdmin(false);
        setUser(null);
        setGameState("login");
        setLoginError("Your session expired. Please sign in again.");
      } else {
        setHostError(
          "Couldn't start a session. Make sure the app server is running, then try again.",
        );
      }
    } finally {
      setIsHosting(false);
    }
  };

  // Host adjusts seconds-per-question while the session is still in the waiting
  // room; the change is pushed to the server so every student gets it.
  const updateTimePerQuestion = async (seconds: number) => {
    setTimePerQuestion(seconds);
    if (roomId && gameState === "hosting") {
      try {
        await api.updateSettings(roomId, { timePerQuestion: seconds });
      } catch (error) {
        console.error("Failed to update time per question:", error);
      }
    }
  };

  const startRoomGame = async () => {
    if (!roomId) return;
    try {
      // Game shows are paced by the host, so they get the longest allowed
      // session rather than the quiz's time limit (which they don't show).
      await api.startSession(roomId, hostPacedMode ? 120 : sessionDurationMinutes);
    } catch (error) {
      console.error("Failed to start session:", error);
    }
  };

  // Clear the student's answer feedback once the host moves to a new question
  // or ends the turn, so stale feedback never sits under a fresh question.
  useEffect(() => {
    const qid = roomData?.gameshow?.questionId ?? null;
    if (qid !== answeredQuestionId) {
      setGameShowResult(null);
      if (qid === null) setAnsweredQuestionId(null);
    }
  }, [roomData?.gameshow?.questionId, roomData?.gameshow?.phase]);

  // ---- Game show host controls -----------------------------------------
  const handleSpin = async () => {
    if (!roomId || gameShowBusy) return;
    setGameShowBusy(true);
    try {
      setRoomData(await api.spin(roomId));
    } catch (error) {
      console.error("Spin failed:", error);
    } finally {
      setGameShowBusy(false);
    }
  };

  /** Student submits an answer for their team. */
  const handleGameShowAnswer = async (option: string) => {
    const info = playerInfoRef.current;
    if (!info || !roomId || gameShowBusy) return;
    setGameShowBusy(true);
    try {
      const res = await api.answerGameShow(roomId, info.id, info.token, option);
      setGameShowResult({ correct: res.correct, correctAnswer: res.correctAnswer });
      setAnsweredQuestionId(res.room.gameshow?.questionId ?? null);
      setRoomData(res.room);
    } catch (error) {
      console.error("Answer failed:", error);
    } finally {
      setGameShowBusy(false);
    }
  };

  const handleNextTurn = async () => {
    if (!roomId || gameShowBusy) return;
    setGameShowBusy(true);
    try {
      setRoomData(await api.nextTurn(roomId));
    } catch (error) {
      console.error("Next turn failed:", error);
    } finally {
      setGameShowBusy(false);
    }
  };

  // ---- Close Call ----------------------------------------------------------
  const handleCloseCallReveal = async () => {
    if (!roomId || gameShowBusy) return;
    setGameShowBusy(true);
    try {
      setRoomData(await api.closeCallReveal(roomId));
    } catch (error) {
      console.error("Reveal failed:", error);
    } finally {
      setGameShowBusy(false);
    }
  };

  const handleCloseCallNext = async () => {
    if (!roomId || gameShowBusy) return;
    setGameShowBusy(true);
    try {
      setRoomData(await api.closeCallNext(roomId));
    } catch (error) {
      console.error("Next round failed:", error);
    } finally {
      setGameShowBusy(false);
    }
  };

  /** Student locks in a guess. Throws so the guess box can show the problem. */
  const handleCloseCallGuess = async (guess: number) => {
    const info = playerInfoRef.current;
    if (!info || !roomId) throw new Error("You're not in a game right now.");
    const res = await api.closeCallGuess(roomId, info.id, info.token, guess);
    setRoomData(res.room);
  };

  // Host ends the live session early; this also ends it for every student.
  const endRoomGame = async () => {
    if (!roomId) return;
    try {
      await api.endSession(roomId);
    } catch (error) {
      console.error("Failed to end session:", error);
    }
  };

  // Host leaves the monitor and returns to the lobby. The session keeps running
  // on the server and can be cleaned up from the admin dashboard.
  const leaveHosting = () => {
    setRoomId("");
    setRoomData(null);
    setPlayers([]);
    setSessionTimeLeft(null);
    setGameState("lobby");
  };

  // "Join my class" from the header or the slideshow: bring the join form
  // into view and put the cursor in the name field.
  const focusJoinForm = () => {
    const field = document.getElementById("student-name");
    field?.scrollIntoView({ block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" });
    field?.focus({ preventScroll: true });
  };

  // Cancelling before the start deletes the session, so it doesn't sit open
  // on the server with students waiting in it for a quiz that won't begin.
  const cancelHosting = async () => {
    const code = roomId;
    leaveHosting();
    if (!code) return;
    try {
      await api.deleteSession(code);
      setAllRooms((prev) => prev.filter((r) => r.id !== code));
    } catch (e) {
      console.error("Couldn't delete the cancelled session:", e);
    }
  };

  // Build the results CSV in the browser and hand it to the user as a
  // download — no server round-trip needed, the data is already loaded.
  const downloadResultsCsv = () => {
    if (!metricsData?.students?.length) return;
    const csv = studentsToCsv(metricsData.students);
    // Prepend a BOM so Excel opens UTF-8 names (accents etc.) correctly.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; the code is shown on screen regardless.
    }
  };

  const fetchMetricsAndAI = async () => {
    setMetricsLoading(true);
    try {
      const computedMetrics = await api.getMetrics();
      setMetricsData(computedMetrics);
      try {
        const aiData = await api.analyzeMetrics(computedMetrics);
        if (aiData.suggestions) setAiSuggestions(aiData.suggestions);
      } catch (e) {
        console.error("Failed to fetch AI suggestions:", e);
      }
    } catch (error) {
      console.error("Error fetching metrics:", error);
    } finally {
      setMetricsLoading(false);
    }
  };

  useEffect(() => {
    if (adminTab === 'reports' && !metricsData) {
       fetchMetricsAndAI();
    }
  }, [adminTab]);

  const handleDeleteRoom = async (code: string) => {
    await api.deleteSession(code);
    setAllRooms((prev) => prev.filter((r) => r.id !== code));
  };

  /** End of a round: show the results screen. */
  const finishRound = () => {
    setGameState("results");
    audio.playEnd();
    if (!prefersReducedMotion) {
      confetti({
        particleCount: 150,
        spread: 120,
        origin: { y: 0.5 },
      });
    }
  };

  /**
   * Live quiz: fetch this player's current question from the server. The
   * server picks the question and starts its clock, so the browser never
   * holds the question list — or any answer — ahead of time.
   */
  const loadLiveQuestion = async () => {
    const info = playerInfoRef.current;
    if (!info || !roomId) return;
    setLiveLoadError(false);
    try {
      const res = await api.quizNext(roomId, info.id, info.token);
      setScore(res.score);
      if (res.done) {
        finishRound();
        return;
      }
      setLiveQuestion(res.question as Question);
      setLiveProgress({ index: res.index, total: res.total });
      setUserAnswer("");
      setShowExplanation(false);
      setIsCorrect(null);
      setAnswerError(null);
      // Pick the clock up where the server has it (matters after a reload).
      setTimeLeft(Math.max(0, activeTimePerQuestion - Math.floor(res.elapsedMs / 1000)));
    } catch (err: any) {
      // 409/404/403: the session ended, was deleted, or no longer knows us.
      if (err?.status === 409 || err?.status === 404 || err?.status === 403) {
        finishRound();
      } else {
        setLiveLoadError(true);
      }
    }
  };

  /**
   * Live quiz: once an answer is graded, the feedback sits below the answers,
   * off-screen on a phone. Scroll it into view and put focus on Continue.
   * Stable (useCallback), so it runs once per feedback panel, not every tick.
   */
  const revealFeedback = useCallback(
    (el: HTMLButtonElement | null) => {
      if (!el) return;
      window.setTimeout(() => {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion ? "auto" : "smooth" });
      }, 350);
    },
    [prefersReducedMotion],
  );

  const startGameLocally = () => {
    setGameState("playing");
    setConfirmExit(false);
    setCurrentQuestionIndex(0);
    setScore(0);
    setGameHistory([]);
    resetQuestionState();
    setRetryQuestions(null);
    setInLiveQuiz(true);
    setLiveQuestion(null);
    setLiveProgress(null);
    setAnswerError(null);
    audio.playStart();
    void loadLiveQuestion();
  };

  const handleStartCampaignConcept = (conceptId: string) => {
    setActiveCampaignConcept(conceptId);
    setSoloAllTopics(false);
    setRetryQuestions(null); // a fresh attempt plays the full concept
    setInLiveQuiz(false);
    setAnswerError(null);
    setGameState("playing");
    setConfirmExit(false);
    setCurrentQuestionIndex(0);
    setScore(0);
    setGameHistory([]);
    resetQuestionState();
    audio.playStart();
  };

  /**
   * Start a mixed round drawn from every skill. It does not set an active
   * concept, so it neither unlocks nor completes anything on the path — it is
   * pure practice.
   */
  const handleStartAllTopics = () => {
    setActiveCampaignConcept(null);
    setSoloAllTopics(true);
    setRetryQuestions(null);
    setInLiveQuiz(false);
    setAnswerError(null);
    setGameState("playing");
    setConfirmExit(false);
    setCurrentQuestionIndex(0);
    setScore(0);
    setGameHistory([]);
    resetQuestionState();
    audio.playStart();
  };

  /** Replay only the questions missed in the attempt just finished. */
  const handleRetryMissed = () => {
    const missed = getMissedQuestions(gameHistory as any);
    if (missed.length === 0) return;
    setRetryQuestions(missed);
    setInLiveQuiz(false);
    setAnswerError(null);
    setGameState("playing");
    setConfirmExit(false);
    setCurrentQuestionIndex(0);
    setScore(0);
    setGameHistory([]);
    resetQuestionState();
    audio.playStart();
  };

  /** A student leaves the waiting room (e.g. they joined the wrong class). */
  const handleLeaveWaiting = () => {
    const info = playerInfoRef.current;
    if (info && roomId) void api.leaveSession(roomId, info.id, info.token).catch(() => {});
    handleExitGame();
  };

  const handleExitGame = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const wasCampaign = !!activeCampaignConcept;
    setConfirmExit(false);
    setActiveCampaignConcept(null);
    setSoloAllTopics(false);
    setRetryQuestions(null);
    setInLiveQuiz(false);
    setAnswerError(null);
    setCurrentQuestionIndex(0);
    setScore(0);
    setGameHistory([]);
    setSessionTimeLeft(null);
    setCountdown(null);
    resetQuestionState();

    if (wasCampaign) {
      // Solo mission: back to the skill map
      setGameState("campaign");
      return;
    }

    // Live session: leave the room
    setRoomId("");
    setRoomData(null);
    if (user?.isAnonymous) {
      // Guests have nowhere else to go — drop them back to the home page
      sessionStorage.removeItem(PLAYER_KEY);
      playerInfoRef.current = null;
      setUser(null);
      setGameState("login");
    } else {
      setGameState(user ? "lobby" : "login");
    }
  };

  const resetQuestionState = () => {
    setTimeLeft(activeTimePerQuestion);
    setUserAnswer("");
    setShowExplanation(false);
    setIsCorrect(null);
  };

  useEffect(() => {
    // Untimed sessions never count down and never auto-submit, so learners
    // who need extended time can work at their own pace.
    if (
      gameState === "playing" &&
      inLiveQuiz &&
      !showExplanation &&
      !isUntimed &&
      !answerPending &&
      !answerError &&
      baseQuestion
    ) {
      if (timeLeft > 0) {
        timerRef.current = setTimeout(() => {
          if (timeLeft <= 6) {
            // will tick continuously for 5, 4, 3, 2, 1
            audio.playTick();
          }
          setTimeLeft((prev) => prev - 1);
        }, 1000);
      } else {
        handleAnswerSubmit("");
      }
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeLeft, gameState, inLiveQuiz, showExplanation, isUntimed, answerPending, answerError, baseQuestion?.id]);

  const handleAnswerSubmit = async (answer: string) => {
    if (showExplanation || answerPending || !baseQuestion) return;
    const question = baseQuestion;
    const secondsLeft = Math.max(0, timeLeft);
    // Record the choice so the results view can highlight which option the
    // learner actually picked alongside the correct one.
    setUserAnswer(answer);
    setAnswerPending(true);
    setAnswerError(null);
    try {
      const info = playerInfoRef.current;
      if (!inLiveQuiz || !info || !roomId) return;
      // The server grades, times and scores the answer. (Solo practice has
      // its own screen, SoloGameShow, and never comes through here.)
      const res = await api.quizAnswer(roomId, info.id, info.token, answer);
      const correct = res.correct;
      const newScore = res.score;
      const key: { correctAnswer: string; explanation: string } = res;

      setRevealed((prev) => ({
        ...prev,
        [question.id]: { correctAnswer: key.correctAnswer, explanation: key.explanation },
      }));
      setIsCorrect(correct);
      setScore(newScore);
      if (correct) {
        audio.playCorrect();
        if (!prefersReducedMotion) {
          confetti({
            particleCount: 50,
            spread: 70,
            origin: { y: 0.6 },
            colors: ["#22c55e", "#ffffff"],
          });
        }
      } else {
        audio.playIncorrect();
      }
      setGameHistory((prev) => [
        ...prev,
        {
          question,
          correct,
          // No meaningful elapsed time to report when the question is untimed.
          timeTaken: isUntimed ? 0 : activeTimePerQuestion - secondsLeft,
        },
      ]);
      setShowExplanation(true);
    } catch (err: any) {
      setUserAnswer("");
      if (inLiveQuiz && err?.status === 409) {
        // The server is not waiting on this question (already answered, or
        // the session ended). Ask it where we are rather than guessing.
        await loadLiveQuestion();
      } else {
        setAnswerError({ answer });
      }
    } finally {
      setAnswerPending(false);
    }
  };

  const nextQuestion = () => {
    if (inLiveQuiz) {
      // The server decides what comes next, and when the quiz is over.
      void loadLiveQuestion();
      return;
    }
    if (currentQuestionIndex < filteredQuestions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
      resetQuestionState();
    } else {
      finishRound();
    }
  };

  const accuracy =
    gameHistory.length > 0
      ? Math.round(
          (gameHistory.filter((h) => h.correct).length / gameHistory.length) *
            100,
        )
      : 0;
  const correctAnswersList = gameHistory.filter((h) => h.correct);
  const fastestTime =
    correctAnswersList.length > 0
      ? Math.min(...correctAnswersList.map((h) => h.timeTaken))
      : "-";

  const getPlayerBadges = (playerHistory: { question: Question; correct: boolean; timeTaken: number }[] | undefined) => {
    if (!playerHistory || playerHistory.length === 0) return [];
    const badges = [];
    
    const pAccuracy = Math.round((playerHistory.filter(h => h.correct).length / playerHistory.length) * 100);
    const pCorrect = playerHistory.filter(h => h.correct);
    const pFastest = pCorrect.length > 0 ? Math.min(...pCorrect.map(h => h.timeTaken)) : null;

    if (pAccuracy === 100) {
        badges.push({ name: 'Perfect Operator', icon: Target, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' });
    } else if (pAccuracy >= 80) {
        badges.push({ name: 'Elite Hacker', icon: Star, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' });
    }

    if (pFastest !== null && pFastest <= 5) {
        badges.push({ name: 'Speed Demon', icon: Zap, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' });
    }

    if (pCorrect.length >= 5) {
         badges.push({ name: 'Streak Master', icon: Award, color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' });
    }

    return badges;
  };

  useEffect(() => {
    if (gameState === "results" && activeCampaignConcept) {
      if (hasPassedConcept(accuracy)) {
        setCompletedConcepts(prev => Array.from(new Set([...prev, activeCampaignConcept])));
        const next = nextConceptId(CONCEPTS, activeCampaignConcept);
        if (next) {
          setUnlockedConcepts(prev => Array.from(new Set([...prev, next])));
        }
      }
    }
  }, [gameState, accuracy, activeCampaignConcept]);

  return (
    // reducedMotion="user" makes every motion component below respect the OS
    // setting, so screen transitions become instant instead of animated.
    <MotionConfig reducedMotion="user">
    <div
      className={cn(
        "min-h-[100dvh] w-full font-sans relative flex flex-col",
        // The game-show projector reads better on the dark stage treatment,
        // so it opts out of the light chrome the other host screens use.
        (gameState === "login" || gameState === "lobby" || gameState === "admin_dashboard" || gameState === "waiting" || gameState === "campaign" ||
          (gameState === "hosting" && !(hostPacedMode && roomData?.status === "started")))
          ? "bg-slate-50 text-slate-900 overflow-y-auto"
          : "bg-[#050505] text-slate-100 selection:bg-blue-500/30 overflow-hidden",
      )}
    >
      {/* Every game-show screen — solo play, the class projector and a
          student's team view — stands on the same studio stage. */}
      {isGameShowScreen && <GameShowStage />}

      {/* Animated Background — purely decorative, so it is dropped entirely
          when the user has asked for reduced motion. */}
      {!isGameShowScreen && !prefersReducedMotion && gameState !== "login" && gameState !== "lobby" && gameState !== "admin_dashboard" && gameState !== "waiting" && gameState !== "hosting" && gameState !== "campaign" && (
        <div className="fixed inset-0 z-0 pointer-events-none">
          {/* Animated Grid */}
          <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,white,transparent)]">
            <motion.div
              animate={{ backgroundPosition: ["0px 0px", "0px 40px"] }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px]"
            />
          </div>

          {/* Ambient Orbs */}
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
              x: [0, 50, 0],
              y: [0, -30, 0],
            }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-0 left-[20%] w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-[120px] mix-blend-screen"
          />
          <motion.div
            animate={{
              scale: [1, 1.5, 1],
              opacity: [0.2, 0.4, 0.2],
              x: [0, -50, 0],
              y: [0, 50, 0],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 1,
            }}
            className="absolute bottom-[-10%] right-[10%] w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-[120px] mix-blend-screen"
          />

          {/* Cyber Scanning Line */}
          <motion.div
            animate={{ y: ["-10vh", "110vh"] }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent shadow-[0_0_10px_rgba(16,185,129,0.5)]"
          />

          {/* Data Stream Code Rain effect elements */}
          {[...Array(6)].map((_, i) => (
            <motion.div
              key={`stream-${i}`}
              className="absolute w-[1px] bg-gradient-to-b from-transparent via-emerald-500/40 to-transparent h-64"
              initial={{ y: "-30vh", left: `${15 + i * 14}%` }}
              animate={{ y: "120vh" }}
              transition={{
                duration: 3 + (i % 3) * 1.5,
                repeat: Infinity,
                delay: i * 0.7,
                ease: "linear",
              }}
            />
          ))}
        </div>
      )}

      <main className="relative z-10 w-full max-w-5xl mx-auto px-4 py-8 lg:py-12 flex flex-col flex-1">
        <AnimatePresence mode="wait">
          {gameState === "campaign" && (
            <motion.div 
              key="campaign" 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="flex flex-col flex-1"
            >
              <SoloMap
                 unlockedConcepts={unlockedConcepts}
                 completedConcepts={completedConcepts}
                 onSelectConcept={handleStartCampaignConcept}
                 onSelectAllTopics={handleStartAllTopics}
                 difficulty={soloDifficulty}
                 onDifficultyChange={setSoloDifficulty}
                 availability={difficultyAvailability(bankQuestions, null)}
                 conceptCounts={Object.fromEntries(
                   CONCEPTS.map((c) => [
                     c.id,
                     selectSoloQuestions(bankQuestions, {
                       conceptId: c.id,
                       difficulty: soloDifficulty,
                     }).length,
                   ]),
                 )}
                 onBack={() => {
                   setGameState("login");
                   setActiveCampaignConcept(null);
                   setSoloAllTopics(false);
                 }}
              />
            </motion.div>
          )}

          {gameState === "login" && (
            <motion.div
              key="login"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="flex-1 flex flex-col items-center w-full"
            >
              {/* On phones the join form comes straight after the slideshow, ahead
                  of "How it works" (flex order); wider screens keep page order. */}
              <div className="max-w-5xl mx-auto w-full flex flex-col gap-10 md:gap-14 pb-10">
                {/* Site header, with the instructor sign-in at the right */}
                <div className="relative z-20 -mb-2 md:-mb-6">
                  <SiteHeader
                    onJoinClass={focusJoinForm}
                    onPracticeSolo={() => setGameState("campaign")}
                    actions={
                      <InstructorSignIn
                        password={instructorPassword}
                        onPasswordChange={(value) => {
                          setInstructorPassword(value);
                          if (loginError) setLoginError("");
                        }}
                        onSubmit={handleLogin}
                        isAuthenticating={isAuthenticating}
                        error={loginError}
                      />
                    }
                  />
                </div>

                {/* Hero */}
                <HomeHero onJoinClass={focusJoinForm} onPracticeSolo={() => setGameState("campaign")} />

                {/* How it works */}
                <div id="how-it-works" className="w-full max-w-4xl mx-auto space-y-6 px-4 md:px-0 scroll-mt-6 max-md:order-1">
                  <h2 className="text-center text-2xl font-extrabold tracking-tight text-slate-900">
                    How it works
                  </h2>
                  <div className="grid sm:grid-cols-3 gap-4">
                    {[
                      {
                        step: "1",
                        icon: <Play className="w-5 h-5" />,
                        title: "Jump in",
                        text: "Join your class with a code, or start a solo mission — it takes seconds.",
                      },
                      {
                        step: "2",
                        icon: <Timer className="w-5 h-5" />,
                        title: "Answer & race the clock",
                        text: "Quick multiple-choice challenges. Faster correct answers earn more points.",
                      },
                      {
                        step: "3",
                        icon: <Brain className="w-5 h-5" />,
                        title: "Learn from every answer",
                        text: "Right or wrong, each question ends with a plain-language explanation.",
                      },
                    ].map((s) => (
                      <div
                        key={s.step}
                        className="p-6 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-sm"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                            {s.icon}
                          </div>
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                            Step {s.step}
                          </span>
                        </div>
                        <h3 className="font-bold text-slate-900">{s.title}</h3>
                        <p className="text-sm text-slate-500 leading-relaxed">
                          {s.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Two ways to play */}
                <div className="grid md:grid-cols-2 gap-8 w-full max-w-4xl mx-auto text-left items-stretch px-4 md:px-0">
                  {/* Students: join a class */}
                  <div className="relative p-8 md:p-10 bg-white border-2 border-blue-200 rounded-3xl space-y-6 shadow-xl shadow-blue-100/60">
                    <div className="absolute -top-3.5 left-8 px-3 py-1 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-widest rounded-full">
                      In class right now?
                    </div>
                    <div className="space-y-2">
                      <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-4">
                        <Users className="w-6 h-6" />
                      </div>
                      <h3 className="text-2xl font-bold text-slate-900 tracking-tight">
                        Join Your Class Session
                      </h3>
                      <p className="text-sm text-slate-500 leading-relaxed">
                        Your teacher will share a 6-letter session code. Type it
                        in with a first name or nickname and you're ready to play together.
                      </p>
                    </div>

                    <form onSubmit={handleGuestJoin} className="space-y-5">
                      <div className="space-y-2">
                        <label
                          htmlFor="student-name"
                          className="block text-xs font-semibold text-slate-700 uppercase tracking-wider ml-1"
                        >
                          Name to show
                        </label>
                        <input
                          id="student-name"
                          type="text"
                          placeholder="First name or nickname"
                          required
                          autoComplete="off"
                          autoCapitalize="words"
                          autoCorrect="off"
                          spellCheck={false}
                          enterKeyHint="next"
                          maxLength={MAX_DISPLAY_NAME}
                          aria-describedby="student-name-hint"
                          value={guestName}
                          onChange={(e) => setGuestName(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-slate-900 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                        />
                        {/* Model the data minimisation the course teaches: ask
                            for the least we need. A nudge, never a block. */}
                        <p
                          id="student-name-hint"
                          aria-live="polite"
                          className={cn(
                            "text-xs ml-1",
                            looksLikeFullName(guestName) ? "text-amber-700 font-medium" : "text-slate-500",
                          )}
                        >
                          {looksLikeFullName(guestName)
                            ? "That looks like a full name. A first name or nickname is enough."
                            : "Not your full name. Your class will see this on the leaderboard."}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label
                          htmlFor="session-code"
                          className="block text-xs font-semibold text-slate-700 uppercase tracking-wider ml-1"
                        >
                          Session Code
                        </label>
                        <input
                          id="session-code"
                          type="text"
                          placeholder="e.g. AB3X9K"
                          required
                          maxLength={6}
                          autoComplete="off"
                          // Phone keyboards: capitals, and no autocorrect
                          // "fixing" a code like AB3X9K into a word.
                          autoCapitalize="characters"
                          autoCorrect="off"
                          spellCheck={false}
                          enterKeyHint="go"
                          value={guestRoomId}
                          onChange={(e) => {
                            setGuestRoomId(e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase());
                            if (joinError) setJoinError("");
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-slate-900 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono font-medium tracking-[0.3em]"
                        />
                      </div>
                      {joinError && (
                        <p role="alert" className="text-sm font-medium text-rose-600 text-center">
                          {joinError}
                        </p>
                      )}
                      <motion.button
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        type="submit"
                        disabled={isAuthenticating}
                        className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl hover:bg-blue-700 transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 text-lg"
                      >
                        {isAuthenticating ? "Connecting..." : "Join Session"}{" "}
                        <ChevronRight className="w-5 h-5" />
                      </motion.button>
                    </form>
                  </div>

                  {/* Solo practice */}
                  <div className="p-8 md:p-10 bg-slate-900 text-white rounded-3xl space-y-6 shadow-xl shadow-slate-900/20 flex flex-col">
                    <div className="space-y-2">
                      <div className="w-12 h-12 bg-white/10 border border-white/10 rounded-xl flex items-center justify-center mb-4">
                        <MapIcon className="w-6 h-6 text-blue-300" />
                      </div>
                      <div className="text-blue-300 font-bold uppercase tracking-widest text-xs flex items-center gap-2">
                        <Star className="w-3 h-3" /> Learn at your own pace
                      </div>
                      <h3 className="text-2xl font-bold tracking-tight">
                        Practice Solo
                      </h3>
                      <p className="text-sm text-slate-400 leading-relaxed">
                        No class? No problem. Work through the five concepts one
                        mission at a time on your personal skill map.
                      </p>
                    </div>

                    <ul className="space-y-3 flex-1">
                      {[
                        "No account or sign-in needed",
                        "Unlock each concept as you master the last",
                        "Every answer comes with a clear explanation",
                      ].map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-3 text-sm text-slate-300"
                        >
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                          {item}
                        </li>
                      ))}
                    </ul>

                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => setGameState("campaign")}
                      className="w-full bg-white text-slate-900 font-bold py-4 rounded-2xl hover:bg-blue-50 transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 text-lg"
                    >
                      Start Training <ChevronRight className="w-5 h-5" />
                    </motion.button>
                  </div>
                </div>

              </div>

            </motion.div>
          )}

          {/* The instructor console: only ever for a signed-in instructor. */}
          {gameState === "lobby" && isAdmin && (
            <motion.div
              key="lobby"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col w-full py-6 md:py-10 space-y-6"
            >
              {/* Console header — part of the page, so it scrolls away with
                  the content instead of floating over it. */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 text-blue-700 font-semibold text-[11px] tracking-widest uppercase">
                    <Shield className="w-3.5 h-3.5" aria-hidden="true" /> Project AIDE · Instructor
                  </div>
                  <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">
                    Instructor Console
                  </h2>
                  <p className="text-slate-600">
                    Host a class session, manage the questions, and check how the app is running.
                  </p>
                </div>
                <div className="flex items-center gap-3 self-end sm:self-start">
                  <div className="text-right">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Signed in</p>
                    <p className="text-xs font-bold text-slate-900">{user?.displayName || "Instructor"}</p>
                  </div>
                  <button
                    onClick={handleSignOut}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-white hover:bg-rose-50 rounded-xl text-slate-600 hover:text-rose-600 transition-colors border border-slate-200 shadow-sm text-sm font-bold"
                  >
                    <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
                  </button>
                </div>
              </div>

              <ConsoleTabs
                active={adminTab}
                onChange={setAdminTab}
                badges={{
                  sessions: allRooms.filter((r) => r.status !== "finished").length,
                  questions: bankQuestions.length,
                }}
              />

              <div id="console-panel" role="tabpanel" aria-labelledby={`console-tab-${adminTab}`}>
                {adminTab === "host" && (
                  <HostPanel
                    mode={prefs.mode}
                    onModeChange={(mode) => updatePrefs({ mode })}
                    difficulty={prefs.difficulty}
                    onDifficultyChange={(difficulty) => updatePrefs({ difficulty })}
                    questionCount={prefs.questionCount}
                    onQuestionCountChange={(questionCount) => updatePrefs({ questionCount })}
                    timePerQuestion={prefs.timePerQuestion}
                    onTimePerQuestionChange={(timePerQuestion) => updatePrefs({ timePerQuestion })}
                    teamCount={prefs.teamCount}
                    onTeamCountChange={(teamCount) => updatePrefs({ teamCount })}
                    rounds={prefs.rounds}
                    onRoundsChange={(rounds) => updatePrefs({ rounds })}
                    closeCallRounds={prefs.closeCallRounds}
                    onCloseCallRoundsChange={(closeCallRounds) => updatePrefs({ closeCallRounds })}
                    availability={difficultyAvailability(bankQuestions, null)}
                    isHosting={isHosting}
                    error={hostError}
                    onStart={createRoom}
                  />
                )}

                {adminTab === "sessions" && (
                  <SessionsPanel
                    sessions={allRooms.map((r) => ({ ...r, code: r.code ?? r.id }))}
                    onDelete={handleDeleteRoom}
                  />
                )}

                {adminTab === "questions" && (
                  <QuestionBankAdmin questions={bankQuestions} onQuestionsChange={setBankQuestions} />
                )}

                {adminTab === "reports" && (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-2xl font-bold text-slate-900 tracking-tight">Reports</h3>
                      <p className="text-sm text-slate-500 mt-1">
                        How students are doing across sessions, and how the question bank lines up with the standards.
                      </p>
                    </div>
                <div className="flex flex-col gap-6">
                  {metricsLoading ? (
                    <div className="p-12 text-center text-slate-500">Loading metrics...</div>
                  ) : metricsData ? (
                    <div className="space-y-8">
                       <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm">
                             <p className="text-xs font-bold text-slate-500 uppercase">Total Students</p>
                             <p className="text-3xl font-bold text-blue-600 mt-2">{metricsData.totalStudents}</p>
                          </div>
                          <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm">
                             <p className="text-xs font-bold text-slate-500 uppercase">Avg Score</p>
                             <p className="text-3xl font-bold text-emerald-600 mt-2">{metricsData.averageScore}</p>
                          </div>
                          <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm">
                             <p className="text-xs font-bold text-slate-500 uppercase">Total Attempts</p>
                             <p className="text-3xl font-bold text-indigo-600 mt-2">{metricsData.totalQuestionsAttempted}</p>
                          </div>
                          <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm">
                             <p className="text-xs font-bold text-slate-500 uppercase">Global Accuracy</p>
                             <p className="text-3xl font-bold text-amber-600 mt-2">{metricsData.accuracy}%</p>
                          </div>
                       </div>
                       
                       <div className="grid md:grid-cols-2 gap-6">
                         <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-4">
                           <h3 className="text-lg font-bold text-slate-800">Skill Breakdown</h3>
                           <div className="h-64 mt-4 w-full">
                             <ResponsiveContainer width="100%" height="100%">
                               <BarChart data={Object.entries(metricsData.skillBreakdown || {}).map(([name, stats]: any) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), Accuracy: Math.round((stats.correct/stats.attempted)*100) }))}>
                                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                 <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748B', fontSize: 12}} dy={10} />
                                 <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748B', fontSize: 12}} dx={-10} domain={[0, 100]} />
                                 <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }} cursor={{fill: '#F1F5F9'}} />
                                 <Bar dataKey="Accuracy" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={50} />
                               </BarChart>
                             </ResponsiveContainer>
                           </div>
                         </div>
                         <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-4">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                               AI Analyst Suggestions
                            </h3>
                            {aiSuggestions ? (
                              <div className="space-y-4">
                                 {aiSuggestions.map((s, i) => (
                                    <div key={i} className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                                       <h4 className="font-bold text-blue-900 mb-1">{s.title}</h4>
                                       <p className="text-sm text-blue-800">{s.description}</p>
                                    </div>
                                 ))}
                              </div>
                            ) : (
                              <div className="text-slate-500 text-sm">Consulting AI Analyst...</div>
                            )}
                         </div>
                       </div>
                       
                       {/* Curriculum coverage — what a district or funder asks for. */}
                       <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-4">
                          <div>
                            <h3 className="text-lg font-bold text-slate-800">Standards Coverage</h3>
                            <p className="text-sm text-slate-500">
                              Alignment of the {bankQuestions.length}-question bank to both anchors Project AIDE
                              asks for: student-learning standards and the workforce framework.
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                              Student-standard identifiers follow AIDE's K-12 crosswalk and are representative:
                              confirm them against the current published standards, and add your state's
                              CS / digital-literacy standards.
                            </p>
                          </div>
                          {(() => {
                            const coverage = standardsCoverage(bankQuestions);
                            const groups = [
                              { label: "Student · CSTA K-12 CS Standards", rows: coverage.csta },
                              { label: "Student · ISTE Standards for Students", rows: coverage.iste },
                              { label: "Student · CYBER.ORG K-12 Cybersecurity", rows: coverage.cyberOrg },
                              { label: "Workforce · NICE Framework", rows: coverage.nice },
                              { label: "Workforce · CompTIA Security+ (SY0-701)", rows: coverage.securityPlus },
                            ];
                            return (
                              <div className="grid md:grid-cols-2 gap-6">
                                {groups.map((g) => (
                                  <div key={g.label} className="space-y-2">
                                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                      {g.label}
                                    </p>
                                    {g.rows.length === 0 ? (
                                      <p className="text-sm text-slate-400">No alignment recorded.</p>
                                    ) : (
                                      <ul className="space-y-2">
                                        {g.rows.map((r) => (
                                          <li
                                            key={r.standard}
                                            className="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl"
                                          >
                                            <span className="text-sm text-slate-700">{r.standard}</span>
                                            <span className="text-xs font-mono font-bold text-slate-500 whitespace-nowrap">
                                              {r.questionCount} q
                                            </span>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                       </div>

                       <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-4">
                          <div>
                            <h3 className="text-lg font-bold text-slate-800">Most Missed Questions</h3>
                            <p className="text-sm text-slate-500">Where the class struggled most — start reteaching here.</p>
                          </div>
                          {metricsData.questionStats?.length ? (
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                                    <th scope="col" className="py-2 pr-4">Question</th>
                                    <th scope="col" className="py-2 px-4 whitespace-nowrap">Concept</th>
                                    <th scope="col" className="py-2 px-4 text-right whitespace-nowrap">Correct</th>
                                    <th scope="col" className="py-2 pl-4 text-right whitespace-nowrap">Missed</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {metricsData.questionStats.map((q: any) => (
                                    <tr key={q.id} className="border-b border-slate-100 last:border-0">
                                      <td className="py-3 pr-4 text-slate-800 max-w-md">{q.question}</td>
                                      <td className="py-3 px-4 whitespace-nowrap">
                                        <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold">
                                          {String(q.concept).replace(/_/g, " ")}
                                        </span>
                                      </td>
                                      <td className="py-3 px-4 text-right font-mono text-slate-600 whitespace-nowrap">
                                        {q.correct}/{q.attempted}
                                      </td>
                                      <td className="py-3 pl-4 text-right whitespace-nowrap">
                                        <span className={cn(
                                          "font-bold font-mono",
                                          q.percentMissed >= 50 ? "text-rose-600"
                                            : q.percentMissed >= 25 ? "text-amber-600"
                                            : "text-emerald-600",
                                        )}>
                                          {q.percentMissed}%
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-slate-500 text-sm">No question data yet — results appear once students have answered.</p>
                          )}
                       </div>

                       <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <h3 className="text-lg font-bold text-slate-800">Student Profiles & Assessment Logs</h3>
                            <button
                              onClick={downloadResultsCsv}
                              disabled={!metricsData.students?.length}
                              title="Export results as a CSV for your gradebook"
                              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-bold rounded-xl transition-colors text-sm flex items-center gap-2"
                            >
                              Download CSV
                            </button>
                          </div>
                          <div className="grid gap-4">
                            {metricsData.students?.map((s: any) => (
                              <div key={s.uid} className="p-4 bg-slate-50 rounded-2xl flex flex-col md:flex-row gap-6 border border-slate-200">
                                 <div className="w-full md:w-1/3 space-y-2">
                                    <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">{s.name}</p>
                                    <div className="flex gap-4">
                                      <div>
                                        <p className="text-[10px] text-slate-500 uppercase font-bold">Score</p>
                                        <p className="text-xl font-bold text-blue-600">{s.score}</p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] text-slate-500 uppercase font-bold">Total Time</p>
                                        <p className="text-xl font-bold text-slate-700">{s.completionTime}s</p>
                                      </div>
                                    </div>
                                 </div>
                                 <div className="w-full md:w-2/3">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Needs Improvement ({s.wrongQuestions.length})</p>
                                    {s.wrongQuestions.length > 0 ? (
                                      <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
                                        {s.wrongQuestions.map((wq: string, idx: number) => (
                                          <li key={idx} className="truncate">{wq}</li>
                                        ))}
                                      </ul>
                                    ) : (
                                       <p className="text-sm text-emerald-600 font-bold">Perfect accuracy!</p>
                                    )}
                                 </div>
                              </div>
                            ))}
                            {(!metricsData.students || metricsData.students.length === 0) && (
                               <p className="text-slate-500 text-sm">No student data available yet.</p>
                            )}
                          </div>
                       </div>
                    </div>
                  ) : null}
                </div>
                  </div>
                )}

                {adminTab === "settings" && (
                  <SettingsPanel
                    sound={prefs.sound}
                    onSoundChange={(sound) => updatePrefs({ sound })}
                    lobbyMusic={prefs.lobbyMusic}
                    onLobbyMusicChange={(on) => updatePrefs({ lobbyMusic: on })}
                    onResetSetup={() => updatePrefs({ ...DEFAULT_PREFS, sound: prefs.sound, lobbyMusic: prefs.lobbyMusic })}
                    questions={bankQuestions}
                    onQuestionsChange={setBankQuestions}
                  />
                )}
              </div>
            </motion.div>
          )}

          {gameState === "waiting" && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col space-y-8 relative max-w-4xl mx-auto w-full py-8 px-4"
            >
              {countdown !== null && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/90 backdrop-blur-sm rounded-3xl flex-col">
                  <motion.div
                    key={countdown}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: [1.5, 1], opacity: 1 }}
                    exit={{ opacity: 0, scale: 2 }}
                    className="text-9xl font-black font-mono text-blue-600 drop-shadow-[0_0_20px_rgba(37,99,235,0.4)]"
                  >
                    {countdown}
                  </motion.div>
                  <p className="text-blue-600/70 mt-6 font-semibold uppercase tracking-widest animate-pulse">
                    Initializing Assessment...
                  </p>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 p-8 rounded-3xl text-center space-y-4 shadow-sm shadow-blue-900/5">
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
                  You're in! Session Code
                </p>
                <h2 className="text-5xl md:text-7xl font-black font-mono tracking-tighter text-blue-700">
                  {roomId}
                </h2>
                <div className="flex justify-center mt-6">
                  <span
                    className={cn(
                      "px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest shadow-sm",
                      difficultyFilter === "easy"
                        ? "bg-green-100 text-green-700 border border-green-200"
                        : difficultyFilter === "medium"
                          ? "bg-yellow-100 text-yellow-700 border border-yellow-200"
                          : difficultyFilter === "hard"
                            ? "bg-red-100 text-red-700 border border-red-200"
                            : "bg-blue-100 text-blue-700 border border-blue-200",
                    )}
                  >
                    Difficulty:{" "}
                    {difficultyFilter === "all" ? "MIXED" : difficultyFilter}
                  </span>
                </div>
                <p className="text-slate-500 text-base mt-6 font-medium flex items-center justify-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
                  </span>
                  Waiting for your instructor to start the session...
                </p>
                <button
                  onClick={handleLeaveWaiting}
                  className="mt-2 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-white/70 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" /> Wrong class? Leave
                </button>
              </div>

              <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between px-2">
                  <h3 className="flex items-center gap-2 font-bold text-lg text-slate-900">
                    <Users className="w-5 h-5 text-blue-600" />
                    In the Session
                  </h3>
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    {players.length} Joined
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 gap-4 overflow-y-auto pr-2 custom-scrollbar max-h-[40vh]">
                  {players.map((p) => (
                    <motion.div
                      layout
                      key={p.uid}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center font-bold text-xl text-blue-600">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 truncate">
                        <p className="font-bold text-slate-900 truncate text-lg">{p.name}</p>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Connected
                        </p>
                      </div>
                    </motion.div>
                  ))}
                  
                  {players.length === 0 && (
                    <div className="col-span-1 sm:col-span-2 p-10 text-center text-slate-500 border border-dashed border-slate-300 rounded-3xl bg-slate-50 mt-2">
                       <p className="font-medium text-slate-600">Waiting for classmates to join...</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {gameState === "hosting" && (
            <motion.div
              key="hosting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col space-y-8 relative max-w-4xl mx-auto w-full py-8 px-4"
            >
              {(() => {
                const started = roomData?.status === "started";
                const ended =
                  roomData?.status === "finished" || sessionTimeLeft === 0;
                const live = started && !ended;

                // Game-show sessions get the projector view once started.
                if (roomData?.mode === "closecall" && roomData.closecall && started && !ended) {
                  return (
                    <CloseCallHost
                      code={roomId}
                      view={roomData.closecall}
                      players={roomData.players}
                      onReveal={handleCloseCallReveal}
                      onNext={handleCloseCallNext}
                      onEnd={endRoomGame}
                      busy={gameShowBusy}
                      reducedMotion={!!prefersReducedMotion}
                    />
                  );
                }

                if (roomData?.mode === "gameshow" && roomData.gameshow && started && !ended) {
                  return (
                    <GameShowHost
                      code={roomId}
                      gameshow={roomData.gameshow}
                      playerCount={players.length}
                      onSpin={handleSpin}
                      onNextTurn={handleNextTurn}
                      onEnd={endRoomGame}
                      busy={gameShowBusy}
                      reducedMotion={!!prefersReducedMotion}
                    />
                  );
                }

                return (
                  <>
                    {/* Header: code + controls */}
                    <div className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm flex flex-col md:flex-row md:items-center gap-6">
                      <div className="flex-1 text-center md:text-left">
                        <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider flex items-center justify-center md:justify-start gap-2">
                          <Crown className="w-4 h-4" /> Hosting · Session Code
                        </p>
                        <div className="flex items-center justify-center md:justify-start gap-3 mt-2">
                          <h2 className="text-5xl md:text-6xl font-black font-mono tracking-tighter text-slate-900">
                            {roomId}
                          </h2>
                          <button
                            onClick={copyRoomCode}
                            title="Copy code"
                            aria-label={codeCopied ? "Session code copied" : "Copy session code"}
                            className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-200 transition-all"
                          >
                            {codeCopied ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                            ) : (
                              <Copy className="w-5 h-5" />
                            )}
                          </button>
                        </div>
                        <p className="text-slate-500 text-sm mt-2 font-medium">
                          {ended
                            ? "Session ended — final results below."
                            : live
                              ? "Session live. Students are playing now."
                              : "Share this code so students can join from the home page."}
                        </p>
                        {!started && !ended && (
                          <button
                            onClick={() => updatePrefs({ lobbyMusic: !prefs.lobbyMusic })}
                            aria-pressed={prefs.lobbyMusic}
                            className={cn(
                              "mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
                              prefs.lobbyMusic
                                ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                                : "bg-white border-slate-200 text-slate-500 hover:text-slate-800",
                            )}
                          >
                            {prefs.lobbyMusic ? (
                              <span aria-hidden="true" className="flex items-end gap-[2px] h-3.5">
                                {[0, 1, 2, 3].map((i) => (
                                  <span
                                    key={i}
                                    className="w-[3px] rounded-full bg-blue-600 music-bar"
                                    style={{ animationDelay: `${i * 0.15}s` }}
                                  />
                                ))}
                              </span>
                            ) : (
                              <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            Waiting-room music: {prefs.lobbyMusic ? "On" : "Off"}
                          </button>
                        )}
                      </div>

                      {live && sessionTimeLeft !== null && (
                        <div className="flex flex-col items-center bg-slate-900 text-white rounded-2xl px-6 py-4 shrink-0">
                          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                            Time Left
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Timer className="w-5 h-5 text-emerald-400" />
                            <span className="text-3xl font-bold font-mono">
                              {Math.floor(sessionTimeLeft / 60)
                                .toString()
                                .padStart(2, "0")}
                              :
                              {(sessionTimeLeft % 60).toString().padStart(2, "0")}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Pre-start: session settings. A game show has no clock, so
                        the timer settings only apply to a live quiz. */}
                    {!started && !ended && !hostPacedMode && (
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col items-center gap-4 shadow-sm">
                          <p className="text-xs font-bold text-slate-700 uppercase tracking-widest shrink-0">
                            Session Time Limit
                          </p>
                          <div className="flex flex-wrap justify-center gap-2">
                            {[1, 3, 5, 10, 15].map((min) => (
                              <button
                                key={min}
                                onClick={() => setSessionDurationMinutes(min)}
                                className={cn(
                                  "px-5 py-2.5 rounded-xl border text-sm font-bold transition-all shadow-sm",
                                  sessionDurationMinutes === min
                                    ? "bg-blue-600 text-white border-blue-700 hover:bg-blue-700"
                                    : "bg-white text-slate-600 border-slate-200 hover:bg-blue-50",
                                )}
                              >
                                {min} min
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col items-center gap-4 shadow-sm">
                          <p className="text-xs font-bold text-slate-700 uppercase tracking-widest shrink-0">
                            Time per Question
                          </p>
                          <div className="flex flex-wrap justify-center gap-2">
                            {[10, 20, 30, 45, 60, 0].map((time) => {
                              const active = activeTimePerQuestion === time;
                              return (
                                <button
                                  key={time}
                                  onClick={() => updateTimePerQuestion(time)}
                                  title={time === 0 ? "No time limit — accessibility accommodation" : undefined}
                                  className={cn(
                                    "px-5 py-2.5 rounded-xl border text-sm font-bold transition-all shadow-sm",
                                    active
                                      ? "bg-blue-600 text-white border-blue-700 hover:bg-blue-700"
                                      : "bg-white text-slate-600 border-slate-200 hover:bg-blue-50",
                                  )}
                                >
                                  {time === 0 ? "Untimed" : `${time}s`}
                                </button>
                              );
                            })}
                          </div>
                          {isUntimed && (
                            <p className="text-xs text-emerald-700 font-medium text-center">
                              Students can take as long as they need on each question.
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* End of a live quiz: the top three on the winners' podium */}
                    {ended && roomData?.mode !== "gameshow" && players.length > 0 && (
                      <WinnersPodium players={players} reducedMotion={!!prefersReducedMotion} />
                    )}

                    {/* Roster / live leaderboard */}
                    <div className="flex-1 space-y-4">
                      <div className="flex items-center justify-between px-2">
                        <h3 className="flex items-center gap-2 font-bold text-lg text-slate-900">
                          {live || ended ? (
                            <Trophy className="w-5 h-5 text-amber-500" />
                          ) : (
                            <Users className="w-5 h-5 text-blue-600" />
                          )}
                          {ended ? "Final Leaderboard" : live ? "Live Leaderboard" : "Students Joined"}
                        </h3>
                        <span className="text-xs font-semibold uppercase text-slate-500">
                          {players.length}{" "}
                          {ended ? "Played" : live ? "Playing" : "Joined"}
                        </span>
                      </div>

                      {!started && !ended ? (
                        <div className="grid sm:grid-cols-2 gap-4 overflow-y-auto pr-2 custom-scrollbar max-h-[40vh]">
                          {players.map((p) => (
                            <motion.div
                              layout
                              key={p.uid}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm"
                            >
                              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center font-bold text-xl text-blue-600">
                                {p.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 truncate">
                                <p className="font-bold text-slate-900 truncate text-lg">
                                  {p.name}
                                </p>
                                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                  Connected
                                </p>
                              </div>
                            </motion.div>
                          ))}
                          {players.length === 0 && (
                            <div className="col-span-1 sm:col-span-2 p-10 text-center text-slate-500 border border-dashed border-slate-300 rounded-3xl bg-slate-50 mt-2">
                              <p className="font-medium text-slate-600">
                                Awaiting student connections...
                              </p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar max-h-[45vh]">
                          {players.map((p, idx) => (
                            <motion.div
                              layout
                              key={p.uid}
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={cn(
                                "flex items-center gap-4 p-4 rounded-2xl border shadow-sm",
                                idx === 0
                                  ? "bg-amber-50 border-amber-200"
                                  : "bg-white border-slate-200",
                              )}
                            >
                              <div
                                className={cn(
                                  "w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg shrink-0",
                                  idx === 0
                                    ? "bg-amber-400 text-white"
                                    : "bg-slate-100 text-slate-500",
                                )}
                              >
                                {idx + 1}
                              </div>
                              <p className="flex-1 font-bold text-slate-900 truncate text-lg">
                                {p.name}
                              </p>
                              <p className="font-mono font-bold text-xl text-slate-900">
                                {p.score.toLocaleString()}
                              </p>
                            </motion.div>
                          ))}
                          {players.length === 0 && (
                            <div className="p-10 text-center text-slate-500 border border-dashed border-slate-300 rounded-3xl bg-slate-50">
                              <p className="font-medium text-slate-600">
                                No students are playing this session.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Controls */}
                    <div className="space-y-3 pt-2">
                      {!started && !ended && (
                        <motion.button
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          onClick={startRoomGame}
                          disabled={players.length === 0}
                          className="w-full py-5 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-md active:scale-95 flex items-center justify-center gap-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Play className="w-5 h-5 fill-current" />
                          {players.length === 0
                            ? "Waiting for students to join"
                            : `Begin Session (${players.length} ready)`}
                        </motion.button>
                      )}

                      {live && (
                        <motion.button
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          onClick={endRoomGame}
                          className="w-full py-4 bg-rose-50 text-rose-600 border border-rose-200 font-bold rounded-2xl hover:bg-rose-100 transition-all flex items-center justify-center gap-2"
                        >
                          End Session Now
                        </motion.button>
                      )}

                      {ended && (
                        <motion.button
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          onClick={leaveHosting}
                          className="w-full py-5 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 text-lg"
                        >
                          Back to console <ChevronRight className="w-5 h-5" />
                        </motion.button>
                      )}

                      {!ended && (
                        <button
                          onClick={live ? leaveHosting : cancelHosting}
                          className="w-full py-3 text-slate-500 hover:text-slate-800 font-semibold text-sm transition-colors"
                        >
                          {live ? "Leave monitor (session keeps running)" : "Cancel session"}
                        </button>
                      )}
                    </div>
                  </>
                );
              })()}
            </motion.div>
          )}

          {gameState === "closecall_play" && roomData?.closecall && (
            <motion.div
              key="closecall_play"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col overflow-y-auto"
            >
              <CloseCallPlayer
                view={roomData.closecall}
                myId={user?.uid}
                players={roomData.players}
                finished={roomData.status === "finished"}
                onGuess={handleCloseCallGuess}
                onExit={handleExitGame}
                reducedMotion={!!prefersReducedMotion}
              />
            </motion.div>
          )}

          {gameState === "gameshow_play" && roomData?.gameshow && (
            <motion.div
              key="gameshow_play"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col"
            >
              <GameShowPlayer
                gameshow={roomData.gameshow}
                myTeamId={roomData.players?.find((p: any) => p.id === user?.uid)?.teamId}
                playerName={user?.displayName ?? undefined}
                lastResult={gameShowResult}
                submitting={gameShowBusy}
                answered={
                  !!roomData.gameshow.questionId &&
                  answeredQuestionId === roomData.gameshow.questionId
                }
                onAnswer={handleGameShowAnswer}
              />
            </motion.div>
          )}

          {gameState === "playing" && !inLiveQuiz && (
            <motion.div
              key="solo-show"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col"
            >
              <SoloGameShow
                title={
                  retryQuestions
                    ? "Second chance: questions you missed"
                    : soloAllTopics
                      ? "All Topics Challenge"
                      : (CONCEPTS.find((c) => c.id === activeCampaignConcept)?.name ?? "Practice")
                }
                questions={filteredQuestions}
                check={(questionId, answer) => api.checkAnswer(questionId, answer)}
                onFinish={({ score: finalScore, history }) => {
                  setScore(finalScore);
                  setGameHistory(history);
                  finishRound();
                }}
                onExit={handleExitGame}
                reducedMotion={!!prefersReducedMotion}
              />
            </motion.div>
          )}

          {gameState === "playing" && inLiveQuiz && !currentQuestion && (
            <motion.div
              key="playing-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center gap-4 text-center"
              role="status"
              aria-live="polite"
            >
              {liveLoadError ? (
                <>
                  <p className="text-lg font-semibold text-white">
                    Couldn't load the next question.
                  </p>
                  <p className="text-sm text-slate-400">Check your connection and try again.</p>
                  <button
                    onClick={() => void loadLiveQuestion()}
                    className="px-5 py-3 rounded-xl bg-emerald-500 text-black font-bold hover:bg-emerald-400 transition-colors"
                  >
                    Try again
                  </button>
                </>
              ) : (
                <p className="text-lg font-semibold text-slate-300">Loading question…</p>
              )}
              <button
                onClick={handleExitGame}
                className="text-sm text-slate-500 hover:text-slate-300 underline"
              >
                Leave
              </button>
            </motion.div>
          )}

          {gameState === "playing" && inLiveQuiz && currentQuestion && (
            <motion.div
              key="playing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col space-y-4 sm:space-y-6"
            >
              <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-2 sm:mb-2 no-scrollbar">
                {(roomId
                  ? players
                  : [
                      {
                        uid: user?.uid || "solo",
                        name: user?.displayName || guestName || "Solo Agent",
                        score,
                      },
                    ]
                )
                  .sort((a, b) => b.score - a.score)
                  .slice(0, 5)
                  .map((p, idx) => (
                    <div
                      key={p.uid}
                      className={cn(
                        "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl border min-w-[84px]",
                        p.uid === user?.uid
                          ? "bg-emerald-500/20 border-emerald-500/50"
                          : "bg-white/5 border-white/10",
                      )}
                    >
                      <p className="text-xs font-semibold text-slate-400 truncate w-[72px] text-center">
                        {p.name}
                      </p>
                      <p className="text-xs font-bold font-mono">{p.score}</p>
                    </div>
                  ))}
              </div>

              <div className="flex items-center justify-between gap-2 bg-white/5 p-3 sm:p-4 rounded-2xl border border-white/10 backdrop-blur-sm">
                <div className="flex items-center gap-4">
                  <div className="hidden sm:block p-2 bg-emerald-500/20 rounded-lg">
                    <Trophy className="w-5 h-5 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                      Score
                    </p>
                    <p className="text-lg sm:text-xl font-bold font-mono">
                      {score.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:gap-6">
                  {sessionTimeLeft !== null && (
                    <div className="flex flex-col items-center">
                      <p className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                        Time left
                      </p>
                      <div className="flex items-center gap-1 sm:gap-2">
                        <Timer className="hidden sm:block w-4 h-4 text-emerald-500" aria-hidden="true" />
                        <span className="text-lg sm:text-xl font-bold font-mono">
                          {Math.floor(sessionTimeLeft / 60)
                            .toString()
                            .padStart(2, "0")}
                          :{(sessionTimeLeft % 60).toString().padStart(2, "0")}
                        </span>
                      </div>
                    </div>
                  )}

                  {isUntimed ? (
                    <div
                      className="relative w-12 h-12 flex items-center justify-center rounded-full border-2 border-emerald-500/40 bg-emerald-500/10"
                      title="Untimed — take as long as you need"
                    >
                      <span className="text-xl font-bold text-emerald-400" aria-hidden="true">
                        ∞
                      </span>
                      <span className="sr-only">Untimed question — no time limit</span>
                    </div>
                  ) : (
                  <div className="relative w-12 h-12 flex items-center justify-center">
                    <svg className="w-full h-full -rotate-90">
                      <circle
                        cx="24"
                        cy="24"
                        r="20"
                        className="stroke-white/5"
                        strokeWidth="4"
                        fill="none"
                      />
                      <motion.circle
                        cx="24"
                        cy="24"
                        r="20"
                        className={
                          timeLeft > 10
                            ? "stroke-emerald-500"
                            : timeLeft > 5
                              ? "stroke-amber-500"
                              : "stroke-rose-500"
                        }
                        strokeWidth="4"
                        fill="none"
                        strokeDasharray="125.6"
                        animate={{
                          strokeDashoffset:
                            125.6 *
                            (1 - Math.max(0, timeLeft) / activeTimePerQuestion),
                        }}
                      />
                    </svg>
                    <span
                      className={cn(
                        "absolute text-sm font-bold font-mono transition-colors",
                        timeLeft > 10
                          ? "text-white"
                          : timeLeft > 5
                            ? "text-amber-500"
                            : "text-rose-500 animate-pulse",
                      )}
                    >
                      {timeLeft}
                    </span>
                  </div>
                  )}
                </div>

                <div className="text-right">
                  <p className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                    <span className="sm:hidden">Q</span>
                    <span className="hidden sm:inline">Question</span>
                  </p>
                  <p className="text-lg sm:text-xl font-bold font-mono">
                    {inLiveQuiz
                      ? `${(liveProgress?.index ?? 0) + 1}/${liveProgress?.total ?? 0}`
                      : `${currentQuestionIndex + 1}/${filteredQuestions.length}`}
                  </p>
                </div>

                <div className="flex items-center pl-2 sm:pl-4 border-l border-white/10">
                  {confirmExit ? (
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest hidden sm:block">
                        Leave game?
                      </p>
                      <button
                        onClick={handleExitGame}
                        className="px-3 py-2 bg-rose-500/20 text-rose-400 border border-rose-500/40 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-rose-500/30 transition-all"
                      >
                        Leave
                      </button>
                      <button
                        onClick={() => setConfirmExit(false)}
                        className="px-3 py-2 bg-white/5 text-slate-300 border border-white/10 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-white/10 transition-all"
                      >
                        Stay
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmExit(true)}
                      title="Exit game"
                      aria-label="Exit game"
                      className="w-11 h-11 flex items-center justify-center bg-white/5 border border-white/10 rounded-lg text-slate-400 hover:text-rose-400 hover:border-rose-500/40 transition-all"
                    >
                      <LogOut className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 flex flex-col justify-center">
                <motion.div
                  key={currentQuestion.id}
                  initial={{ x: 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  className="space-y-5 sm:space-y-8"
                >
                  <div className="space-y-3 sm:space-y-4 text-center max-w-2xl mx-auto">
                    <span className="px-3 py-1 bg-white/5 rounded-full border border-white/10 text-xs font-mono uppercase text-emerald-500">
                      SEC-LEVEL: {currentQuestion.difficulty}
                    </span>

                    {currentQuestion.imageUrl && (
                      <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-xl mx-auto mt-6 mb-4 bg-black/40">
                        <img
                          src={currentQuestion.imageUrl}
                          alt="Mission intel visual"
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}

                    <h2 className="text-lg sm:text-2xl lg:text-3xl font-bold leading-snug sm:leading-tight tracking-tight text-white break-words">
                      {currentQuestion.question}
                    </h2>
                  </div>

                  <div className="grid gap-2.5 sm:gap-4 max-w-xl mx-auto w-full">
                    {currentQuestion.type === "mcq" &&
                      currentQuestion.options?.map((option, idx) => (
                        <motion.button
                          key={idx}
                          disabled={showExplanation || answerPending}
                          onClick={() => handleAnswerSubmit(option)}
                          whileHover={!showExplanation && !prefersReducedMotion ? { scale: 1.02 } : {}}
                          whileTap={!showExplanation && !prefersReducedMotion ? { scale: 0.98 } : {}}
                          animate={
                            prefersReducedMotion
                              ? {}
                              : showExplanation &&
                                  option === currentQuestion.correctAnswer
                                ? {
                                    scale: [1, 1.05, 1],
                                    transition: { duration: 0.3 },
                                  }
                                : showExplanation &&
                                    isCorrect === false &&
                                    userAnswer === option
                                  ? {
                                      x: [-10, 10, -10, 10, 0],
                                      transition: { duration: 0.4 },
                                    }
                                  : {}
                          }
                          className={cn(
                            "group relative px-4 py-3.5 sm:p-5 bg-white/5 border border-white/10 text-left rounded-2xl transition-colors",
                            "focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]",
                            !showExplanation
                              ? "hover:border-emerald-500/50 hover:bg-emerald-500/5"
                              : option === currentQuestion.correctAnswer
                                ? "border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)] z-10"
                                : isCorrect === false && userAnswer === option
                                  ? "border-rose-500 bg-rose-500/10 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)] z-10"
                                  : "opacity-50",
                          )}
                        >
                          <span className="font-medium">{option}</span>
                          {showExplanation && (
                            <span className="sr-only">
                              {option === currentQuestion.correctAnswer
                                ? " — correct answer"
                                : userAnswer === option
                                  ? " — your answer, incorrect"
                                  : ""}
                            </span>
                          )}
                        </motion.button>
                      ))}
                  </div>
                </motion.div>
              </div>

              {/* Grading happens on the server, so it can fail (e.g. the
                  connection dropped). Say so and let the learner retry. */}
              {answerError && (
                <div
                  role="alert"
                  className="max-w-xl mx-auto w-full p-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm flex flex-wrap items-center justify-between gap-3"
                >
                  <span>Couldn't check your answer. Check your connection and try again.</span>
                  <button
                    onClick={() => handleAnswerSubmit(answerError.answer)}
                    className="px-4 py-2 rounded-xl bg-amber-400 text-black font-bold hover:bg-amber-300 transition-colors"
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* Screen-reader announcement of the result. Visually hidden
                  because the same information is conveyed on screen. */}
              <div className="sr-only" role="status" aria-live="polite">
                {showExplanation
                  ? isCorrect
                    ? `Correct. Your score is now ${score}.`
                    : `Incorrect. The correct answer is: ${(currentQuestion.correctAnswer ?? "").replace(/[.!?]+$/, "")}. Your score is ${score}.`
                  : ""}
              </div>

              <AnimatePresence>
                {showExplanation && (
                  <motion.div
                    initial={{ y: 20, opacity: 0, scale: 0.95 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    className={cn(
                      "p-6 border rounded-2xl space-y-4 shadow-xl backdrop-blur-md relative overflow-hidden",
                      isCorrect
                        ? "bg-emerald-950/40 border-emerald-500/30"
                        : "bg-rose-950/40 border-rose-500/30",
                    )}
                  >
                    <div className="flex gap-4 relative z-10">
                      {isCorrect ? (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1, rotate: [0, 15, -15, 0] }}
                          transition={{
                            type: "tween",
                            duration: 0.5,
                            delay: 0.1,
                          }}
                          className="p-3 bg-emerald-500/20 rounded-xl shrink-0 h-fit"
                        >
                          <ShieldCheck className="w-8 h-8 text-emerald-500" />
                        </motion.div>
                      ) : (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1, x: [-5, 5, -5, 5, 0] }}
                          transition={{
                            type: "tween",
                            duration: 0.5,
                            delay: 0.1,
                          }}
                          className="p-3 bg-rose-500/20 rounded-xl shrink-0 h-fit"
                        >
                          <ShieldAlert className="w-8 h-8 text-rose-500" />
                        </motion.div>
                      )}
                      <div>
                        <motion.h3
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.2 }}
                          className={cn(
                            "font-bold text-lg mb-1",
                            isCorrect ? "text-emerald-400" : "text-rose-400",
                          )}
                        >
                          {isCorrect ? "ACCESS GRANTED" : "ACCESS DENIED"}
                        </motion.h3>
                        <motion.p
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.3 }}
                          className="text-sm text-slate-300 leading-relaxed"
                        >
                          {currentQuestion.explanation}
                        </motion.p>
                        {/* Standards alignment: the student-learning anchor and
                            the workforce anchor Project AIDE asks for. */}
                        {(() => {
                          const tags = learnerStandardTags(currentQuestion);
                          if (tags.length === 0) return null;
                          return (
                            <ul className="flex flex-wrap gap-2 pt-1" aria-label="Standards this question covers">
                              {tags.map((tag) => (
                                <li
                                  key={tag.label}
                                  title={tag.title}
                                  className={cn(
                                    "px-2 py-1 rounded-lg border text-xs font-semibold",
                                    tag.anchor === "student"
                                      ? "bg-sky-400/10 border-sky-400/30 text-sky-200"
                                      : "bg-white/5 border-white/10 text-slate-400",
                                  )}
                                >
                                  {tag.label}
                                </li>
                              ))}
                            </ul>
                          );
                        })()}
                      </div>
                    </div>
                    <motion.button
                      ref={revealFeedback}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                      onClick={nextQuestion}
                      className={cn(
                        "w-full py-4 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-opacity-90 transition-all relative z-10",
                        isCorrect
                          ? "bg-emerald-500 text-black hover:bg-emerald-400"
                          : "bg-rose-500 text-white hover:bg-rose-400 hover:text-white",
                      )}
                    >
                      CONTINUE MISSION <ChevronRight className="w-5 h-5" />
                    </motion.button>
                    {/* Background glow decoration */}
                    <div
                      className={cn(
                        "absolute top-0 right-0 w-32 h-32 blur-3xl -z-0 rounded-full",
                        isCorrect ? "bg-emerald-500/20" : "bg-rose-500/20",
                      )}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {gameState === "results" && (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col space-y-10 py-4"
            >
              <div className="text-center space-y-2">
                <h2 className="text-4xl font-bold tracking-tight">
                  OPERATIONAL DEBRIEF
                </h2>
                <p className="text-slate-500 uppercase text-xs font-mono tracking-widest">
                  Real-time Session Leaderboard
                </p>
              </div>

              {/* Live quiz: the top three appear once the whole session is over,
                  so early finishers see the final podium, not a partial one. */}
              {roomId && roomData && roomData.mode !== "gameshow" && (
                roomData.status === "finished" || (roomData.endTime > 0 && Date.now() >= roomData.endTime) ? (
                  <WinnersPodium players={players} youUid={user?.uid} reducedMotion={!!prefersReducedMotion} />
                ) : (
                  <p role="status" className="text-center text-sm font-medium text-slate-500">
                    Waiting for the rest of the class to finish. The top three will appear here when the session ends.
                  </p>
                )
              )}

              <div className="grid lg:grid-cols-2 gap-8">
                {/* Personal Stats Overview */}
                <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 flex flex-col gap-6">
                  <h3 className="text-xl font-bold text-slate-300">
                    Agent Performance Data
                  </h3>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-6 bg-black/40 rounded-3xl border border-white/5 flex flex-col items-center justify-center text-center">
                      <p className="text-slate-500 uppercase text-[10px] font-mono tracking-widest mb-1">
                        Accuracy
                      </p>
                      <p className="text-3xl font-bold text-white">
                        {accuracy}%
                      </p>
                    </div>
                    <div className="p-6 bg-black/40 rounded-3xl border border-white/5 flex flex-col items-center justify-center text-center">
                      <p className="text-slate-500 uppercase text-[10px] font-mono tracking-widest mb-1">
                        Fastest Hack
                      </p>
                      <p className="text-3xl font-bold text-white">
                        {fastestTime}s
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 mt-4">
                    <p className="text-slate-500 uppercase text-[10px] font-mono tracking-widest mb-4">
                      Clearance Breakdown
                    </p>
                    <div className="space-y-3">
                      {["easy", "medium", "hard", "boss"].map((diff) => {
                        const items = gameHistory.filter(
                          (h) => h.question.difficulty === diff,
                        );
                        if (items.length === 0) return null;
                        const correctCount = items.filter(
                          (h) => h.correct,
                        ).length;
                        return (
                          <div
                            key={diff}
                            className="flex justify-between items-center text-sm"
                          >
                            <span className="font-mono uppercase text-slate-400 min-w-[60px]">
                              {diff}
                            </span>
                            <div className="flex items-center gap-3 w-2/3">
                              <div className="flex-1 bg-black/40 h-2 rounded-full overflow-hidden border border-white/5 relative">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{
                                    width: `${(correctCount / items.length) * 100}%`,
                                  }}
                                  transition={{ duration: 1, delay: 0.5 }}
                                  className="absolute top-0 left-0 bg-emerald-500 h-full"
                                />
                              </div>
                              <span className="font-mono text-emerald-500 font-bold min-w-[30px] text-right">
                                {correctCount}/{items.length}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* On wide screens the leaderboard scrolls inside its box, beside
                    the stats. On phones it simply grows with the page, so there's
                    no scroll box inside a scrolling page. */}
                <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col lg:max-h-[60vh]">
                  <div className="p-6 border-b border-white/10 bg-white/5">
                    <div className="grid grid-cols-12 gap-4 text-xs font-mono text-slate-500 uppercase tracking-widest">
                      <div className="col-span-1">Pos</div>
                      <div className="col-span-7">Agent</div>
                      <div className="col-span-4 text-right">Combat Score</div>
                    </div>
                  </div>
                  <div className="flex-1 lg:overflow-y-auto custom-scrollbar p-6 space-y-3">
                    {(roomId
                      ? players
                      : [
                          {
                            uid: user?.uid || "solo",
                            name: user?.displayName || guestName || "Solo Agent",
                            score,
                          },
                        ]
                    )
                      .sort((a, b) => b.score - a.score)
                      .map((p, idx) => {
                        const badges = getPlayerBadges(p.history || (p.uid === user?.uid ? gameHistory : []));
                        return (
                        <motion.div
                          layout
                          key={p.uid}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className={cn(
                            "flex flex-col gap-2 p-4 rounded-2xl border transition-all",
                            p.uid === user?.uid
                              ? "bg-emerald-500/10 border-emerald-500/30 scale-[1.02] shadow-[0_0_20px_rgba(16,185,129,0.1)]"
                              : "bg-white/5 border-white/5",
                          )}
                        >
                          <div className="grid grid-cols-12 gap-4 items-center">
                            <div className="col-span-1 font-mono font-bold text-slate-500">
                              #{idx + 1}
                            </div>
                            <div className="col-span-7 font-bold flex items-center gap-3">
                              <div className="w-6 h-6 bg-emerald-500/20 rounded-full flex items-center justify-center text-[10px]">
                                {p.name.charAt(0)}
                              </div>
                              <span className="truncate">
                                {p.name} {p.uid === user?.uid && "(YOU)"}
                              </span>
                            </div>
                            <div className="col-span-4 text-right font-mono font-bold text-emerald-500 flex items-center justify-end gap-2">
                              {p.score}
                            </div>
                          </div>
                          {badges.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-1 ml-10">
                              {badges.map((b, i) => {
                                const Icon = b.icon;
                                return (
                                  <div key={i} className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] uppercase font-bold tracking-widest", b.color)}>
                                    <Icon className="w-3 h-3" />
                                    {b.name}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </motion.div>
                      )})}
                  </div>
                </div>
              </div>

              {/* Campaign outcome: tell the learner where they stand and, if
                  they fell short, let them retry just the items they missed. */}
              {activeCampaignConcept && (
                <div
                  className={cn(
                    "rounded-2xl border p-5 text-center",
                    hasPassedConcept(accuracy)
                      ? "bg-emerald-500/10 border-emerald-500/30"
                      : "bg-amber-500/10 border-amber-500/30",
                  )}
                >
                  {hasPassedConcept(accuracy) ? (
                    <p className="font-bold text-emerald-400">
                      Concept complete — {accuracy}% accuracy. Next concept unlocked.
                    </p>
                  ) : (
                    <p className="font-bold text-amber-400">
                      {accuracy}% accuracy — {CAMPAIGN_PASS_THRESHOLD}% is needed to
                      unlock the next concept. Review the explanations above, then
                      retry the questions you missed.
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-4 mt-8">
                {activeCampaignConcept &&
                  !hasPassedConcept(accuracy) &&
                  getMissedQuestions(gameHistory as any).length > 0 && (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleRetryMissed}
                      className="flex-1 py-5 bg-amber-500 text-black font-bold rounded-2xl hover:bg-amber-400 transition-all flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-5 h-5" />
                      RETRY {getMissedQuestions(gameHistory as any).length} MISSED
                    </motion.button>
                  )}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  // A solo mission goes back to the map; a student in a live
                  // session leaves it and goes home (never the instructor console).
                  onClick={activeCampaignConcept ? () => setGameState("campaign") : handleExitGame}
                  className="flex-1 py-5 bg-white text-black font-bold rounded-2xl hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
                >
                  {activeCampaignConcept ? <MapIcon className="w-5 h-5" /> : <Home className="w-5 h-5" />}
                  {activeCampaignConcept ? "RETURN TO CAMPAIGN" : "BACK TO HOME"}
                </motion.button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* Organisation block — outside <main> so its closing band can run edge
          to edge rather than stopping at the content column. */}
      {gameState === "login" && <AboutReadyForce />}

      {/* The session code, as a reference while in a session. (It used to
          claim "ENCRYPTION: AES-256", which the app doesn't do — not a claim a
          security course should make.) */}
      {gameState !== "login" && roomId && (
        <footer className="py-6 text-center text-slate-500 text-xs font-mono uppercase tracking-[0.2em] border-t border-white/5">
          Session {roomId}
        </footer>
      )}
    </div>
    </MotionConfig>
  );
}
