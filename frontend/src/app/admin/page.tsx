"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Play,
  RotateCcw,
  Lock,
  CheckCircle,
  XCircle,
  Users,
  Coins,
} from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import {
  MOCK_QUESTIONS,
  getQuizIndex,
  setQuizIndex,
  getQuizEntryState,
  setQuizEntryState,
  getQuizAnswers,
  getQuizMarks,
  setQuizMarks,
  addQuizScores,
  resetQuiz,
  isAdmin,
  QUIZ_ANSWERS_KEY,
} from "@/lib/quizState";
import type { EntryState, PlayerAnswer, PlayerMark } from "@/lib/quizState";
import {
  QUIZ_WINNER_MARKET,
  resetBettingGame,
  settleQuizWinnerMarket,
  isMarketSettled,
} from "@/lib/bettingState";
import type { SettlementResult } from "@/lib/bettingState";

export default function AdminPage() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [questionIndex, setQuestionIndex] = useState(-1);
  const [entryState, setEntryState] = useState<EntryState>("open");
  const [answers, setAnswers] = useState<PlayerAnswer[]>([]);
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [betsSettled, setBetsSettled] = useState(false);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("username");
    if (!stored) {
      router.replace("/login");
      return;
    }
    if (!isAdmin(stored)) {
      router.replace("/quiz");
      return;
    }
    setUsername(stored);
    setBetsSettled(isMarketSettled(QUIZ_WINNER_MARKET));
    const idx = getQuizIndex();
    setQuestionIndex(idx);
    if (idx >= 0) {
      const state = getQuizEntryState();
      setEntryState(state);
      setAnswers(getQuizAnswers(idx));
      const saved = getQuizMarks(idx);
      setMarks(Object.fromEntries(saved.map((m) => [m.username, m.correct])));
    }
  }, [router]);

  // Reload answers whenever a player submits in another tab.
  useEffect(() => {
    if (questionIndex < 0) return;
    function onStorage(e: StorageEvent) {
      if (e.key === QUIZ_ANSWERS_KEY) {
        setAnswers(getQuizAnswers(questionIndex));
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [questionIndex]);

  function navigate(newIndex: number) {
    if (newIndex === -1) {
      // Restarting the quiz also wipes the betting game: budgets, placed bets
      // and settlement all reset so the next quiz starts clean.
      resetQuiz();
      resetBettingGame();
      setBetsSettled(false);
      setSettlement(null);
    } else {
      setQuizIndex(newIndex);
      setQuizEntryState("open");
    }
    setQuestionIndex(newIndex);
    setEntryState("open");
    setAnswers([]);
    setMarks({});
  }

  // End-of-quiz payout for "Wie wint de quiz?". Uses the final scores to
  // determine the winner(s) and credits winning bettors. Idempotent.
  function handleSettleBets() {
    const result = settleQuizWinnerMarket();
    if (result) setSettlement(result);
    setBetsSettled(true);
  }

  function handleCloseEntry() {
    setQuizEntryState("closed");
    setEntryState("closed");
  }

  function toggleMark(user: string, correct: boolean) {
    const newMarks = { ...marks, [user]: correct };
    setMarks(newMarks);
    const arr: PlayerMark[] = Object.entries(newMarks).map(([u, c]) => ({
      username: u,
      correct: c,
    }));
    setQuizMarks(questionIndex, arr);
  }

  function handleFinalize() {
    const arr: PlayerMark[] = Object.entries(marks).map(([u, c]) => ({
      username: u,
      correct: c,
    }));
    // Write marks before changing entry state so players read fresh data.
    setQuizMarks(questionIndex, arr);
    addQuizScores(arr);
    setQuizEntryState("finalized");
    setEntryState("finalized");
  }

  function handleLogout() {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("username");
    router.push("/login");
  }

  if (!username) return null;

  const question = questionIndex >= 0 ? MOCK_QUESTIONS[questionIndex] : null;
  const isWaiting = questionIndex === -1;
  const isLast = questionIndex === MOCK_QUESTIONS.length - 1;
  const allMarked =
    answers.length === 0 || answers.every((a) => a.username in marks);

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-1.5 px-2 text-sm font-medium text-primary">
          <ShieldCheck className="h-4 w-4" />
          Admin
        </div>
        <div className="flex items-center gap-1">
          {!isWaiting && (
            <button
              onClick={() => navigate(-1)}
              aria-label="Restart quiz"
              className="flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
            >
              <RotateCcw className="h-5 w-5" />
              Restart
            </button>
          )}
          <button
            onClick={handleLogout}
            aria-label="Logout"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
          >
            <LogOut className="h-6 w-6" />
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-5 p-6">
        {isWaiting ? (
          <>
            <div className="text-center">
              <p className="text-lg font-medium">Ready to start</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Players are waiting. Press Start to show the first question.
              </p>
            </div>
            <Button onClick={() => navigate(0)} size="lg" className="w-full max-w-md gap-1.5">
              <Play className="h-5 w-5" />
              Start Quiz
            </Button>
          </>
        ) : question ? (
          <>
            {/* Question header */}
            <div className="w-full max-w-md text-center">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <p className="text-sm text-muted-foreground">
                  Question {questionIndex + 1} of {MOCK_QUESTIONS.length}
                </p>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {question.type === "multiple_choice" ? "Multiple choice" : "Text"}
                </span>
                {entryState === "closed" && (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                    Closed
                  </span>
                )}
                {entryState === "finalized" && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    Finalized
                  </span>
                )}
              </div>
              <h2 className="mt-2 text-xl font-semibold leading-tight">
                {question.text}
              </h2>
            </div>

            {/* Answers list */}
            <div className="w-full max-w-md">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <Users className="h-4 w-4 text-muted-foreground" />
                {entryState === "open"
                  ? `Live Answers (${answers.length})`
                  : entryState === "closed"
                  ? `Mark Answers (${answers.length})`
                  : `Results (${answers.length})`}
              </div>

              {answers.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">
                  No answers yet.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {answers.map(({ username: u, answer }) => (
                    <div
                      key={u}
                      className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                    >
                      <span className="w-20 shrink-0 truncate font-medium">
                        {u}
                      </span>
                      <span className="flex-1 truncate text-muted-foreground">
                        &ldquo;{answer}&rdquo;
                      </span>

                      {/* Mark buttons (closed state) */}
                      {entryState === "closed" && (
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            onClick={() => toggleMark(u, true)}
                            aria-label={`Mark ${u} correct`}
                            className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
                              marks[u] === true
                                ? "bg-green-500 text-white"
                                : "border text-muted-foreground hover:bg-green-50 active:bg-green-100"
                            }`}
                          >
                            <CheckCircle className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => toggleMark(u, false)}
                            aria-label={`Mark ${u} incorrect`}
                            className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
                              marks[u] === false
                                ? "bg-red-500 text-white"
                                : "border text-muted-foreground hover:bg-red-50 active:bg-red-100"
                            }`}
                          >
                            <XCircle className="h-5 w-5" />
                          </button>
                        </div>
                      )}

                      {/* Result icon (finalized state) */}
                      {entryState === "finalized" && (
                        <span className="shrink-0">
                          {marks[u] === true ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action buttons */}
            {entryState === "open" && (
              <Button
                variant="outline"
                onClick={handleCloseEntry}
                size="lg"
                className="w-full max-w-md gap-1.5"
              >
                <Lock className="h-5 w-5" />
                Close Entry
              </Button>
            )}

            {entryState === "closed" && (
              <Button
                onClick={handleFinalize}
                disabled={!allMarked}
                size="lg"
                className="w-full max-w-md"
              >
                Finalize Results
              </Button>
            )}

            {/* End-of-quiz betting payout, shown once the final question is finalized. */}
            {entryState === "finalized" && isLast && (
              <div className="w-full max-w-md rounded-xl border bg-card p-4">
                <div className="mb-1 flex items-center gap-2">
                  <Coins className="h-5 w-5 text-amber-600" />
                  <h3 className="font-semibold">Wie wint de quiz?</h3>
                </div>
                {betsSettled ? (
                  <div className="text-sm text-muted-foreground">
                    {settlement ? (
                      <p>
                        Paid out{" "}
                        <span className="font-semibold text-foreground">
                          {settlement.paidOut}
                        </span>{" "}
                        coins.{" "}
                        {settlement.winners.length > 0
                          ? `Winner${
                              settlement.winners.length > 1 ? "s" : ""
                            }: ${settlement.winners.join(", ")}.`
                          : "No winner (no scores)."}{" "}
                        {settlement.wonCount} winning / {settlement.lostCount}{" "}
                        losing bet(s).
                      </p>
                    ) : (
                      <p>Bets have been settled.</p>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="mb-3 text-sm text-muted-foreground">
                      Pay out the winner bets using the current standings before
                      resetting the quiz.
                    </p>
                    <Button
                      onClick={handleSettleBets}
                      size="lg"
                      className="w-full gap-1.5"
                    >
                      <Coins className="h-5 w-5" />
                      Pay Out Bets
                    </Button>
                  </>
                )}
              </div>
            )}

            {entryState === "finalized" && (
              <div className="flex w-full max-w-md gap-3">
                {questionIndex > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => navigate(questionIndex - 1)}
                    size="lg"
                    className="flex-1 gap-1.5"
                  >
                    <ChevronLeft className="h-5 w-5" />
                    Previous
                  </Button>
                )}
                {isLast ? (
                  <Button
                    variant="outline"
                    onClick={() => navigate(-1)}
                    size="lg"
                    className="flex-1 gap-1.5"
                  >
                    <RotateCcw className="h-5 w-5" />
                    Reset Quiz
                  </Button>
                ) : (
                  <Button
                    onClick={() => navigate(questionIndex + 1)}
                    size="lg"
                    className="flex-1 gap-1.5"
                  >
                    Next Question
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                )}
              </div>
            )}
          </>
        ) : null}
      </main>

      <BottomNav quizHref="/admin" />
    </div>
  );
}
