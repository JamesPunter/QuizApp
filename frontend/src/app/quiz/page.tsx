"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Clock, Timer, Lock, CheckCircle, XCircle } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  MOCK_QUESTIONS,
  getQuizIndex,
  getQuizEntryState,
  getQuizAnswers,
  addQuizAnswer,
  getPlayerMark,
  isAdmin,
  QUIZ_INDEX_KEY,
  QUIZ_ENTRY_STATE_KEY,
} from "@/lib/quizState";
import type { Question, EntryState } from "@/lib/quizState";
import { registerPlayer } from "@/lib/bettingState";

const LETTERS = ["A", "B", "C", "D"];

export default function QuizPage() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [questionIndex, setQuestionIndex] = useState(-1);
  const [entryState, setEntryState] = useState<EntryState>("open");
  const [textAnswer, setTextAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [myMark, setMyMark] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("username");
    if (!stored) {
      router.replace("/login");
      return;
    }
    if (isAdmin(stored)) {
      router.replace("/admin");
      return;
    }
    // Register in the betting roster so the player shows up in the betting
    // lists as soon as they join, without needing to open the Betje page.
    registerPlayer(stored);
    setUsername(stored);

    const idx = getQuizIndex();
    setQuestionIndex(idx);

    if (idx >= 0) {
      const state = getQuizEntryState();
      setEntryState(state);
      if (getQuizAnswers(idx).some((a) => a.username === stored)) {
        setSubmitted(true);
      }
      if (state === "finalized") {
        setMyMark(getPlayerMark(idx, stored));
      }
    }

    // React to admin actions in the other tab.
    // Replace with WebSocket events once the backend is ready.
    function onStorage(e: StorageEvent) {
      if (e.key === QUIZ_INDEX_KEY) {
        const newIdx = e.newValue !== null ? parseInt(e.newValue, 10) : -1;
        setQuestionIndex(newIdx);
        setTextAnswer("");
        setSubmitted(false);
        setMyMark(null);
        setEntryState("open");
      }
      if (e.key === QUIZ_ENTRY_STATE_KEY) {
        const newState = (e.newValue as EntryState | null) ?? "open";
        setEntryState(newState);
        if (newState === "finalized") {
          const curIdx = getQuizIndex();
          const storedUser = sessionStorage.getItem("username");
          if (curIdx >= 0 && storedUser) {
            setMyMark(getPlayerMark(curIdx, storedUser));
          }
        }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [router]);

  function handleLogout() {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("username");
    router.push("/login");
  }

  function handleSubmitText(e: React.FormEvent) {
    e.preventDefault();
    if (!textAnswer.trim() || !username || questionIndex < 0) return;
    addQuizAnswer(questionIndex, { username, answer: textAnswer.trim() });
    setSubmitted(true);
    // TODO: also send to backend
  }

  function handleSelectOption(option: string) {
    if (!username || questionIndex < 0) return;
    addQuizAnswer(questionIndex, { username, answer: option });
    setSubmitted(true);
    // TODO: also send to backend
  }

  if (!username) return null;

  // Full-screen result after admin finalizes.
  if (entryState === "finalized" && questionIndex >= 0) {
    if (myMark === null) {
      return (
        <div className="flex min-h-screen flex-col bg-background pb-20">
          <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
            <XCircle className="h-16 w-16" />
            <p className="text-xl font-medium">No answer submitted</p>
          </main>
          <BottomNav />
        </div>
      );
    }
    return (
      <div
        className={`flex min-h-screen flex-col pb-20 ${
          myMark ? "bg-green-500" : "bg-red-500"
        }`}
      >
        <main className="flex flex-1 flex-col items-center justify-center gap-4 text-white">
          {myMark ? (
            <>
              <CheckCircle className="h-24 w-24" />
              <h1 className="text-5xl font-bold">Correct!</h1>
              <p className="text-xl opacity-90">+1 point</p>
            </>
          ) : (
            <>
              <XCircle className="h-24 w-24" />
              <h1 className="text-5xl font-bold">Incorrect</h1>
            </>
          )}
        </main>
        <BottomNav />
      </div>
    );
  }

  const question: Question | undefined =
    questionIndex >= 0 ? MOCK_QUESTIONS[questionIndex] : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="flex items-center justify-end px-2 py-2">
        <button
          onClick={handleLogout}
          aria-label="Logout"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
        >
          <LogOut className="h-6 w-6" />
        </button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center p-8">
        {questionIndex === -1 ? (
          // Waiting for first question
          <div className="flex flex-col items-center gap-3 text-center">
            <Clock className="h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">Waiting for the next question…</p>
          </div>
        ) : submitted ? (
          // Answer in — waiting for admin to close & finalize
          <div className="flex flex-col items-center gap-3 text-center">
            <Timer className="h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">Answer submitted!</p>
            <p className="text-sm text-muted-foreground">Waiting for results…</p>
          </div>
        ) : entryState === "closed" ? (
          // Entry closed before this player submitted
          <div className="flex flex-col items-center gap-3 text-center">
            <Lock className="h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">Entry is closed.</p>
            <p className="text-sm text-muted-foreground">Waiting for results…</p>
          </div>
        ) : question ? (
          // Active question — show input
          <QuestionView
            question={question}
            index={questionIndex}
            total={MOCK_QUESTIONS.length}
            textAnswer={textAnswer}
            onTextChange={setTextAnswer}
            onSubmitText={handleSubmitText}
            onSelectOption={handleSelectOption}
          />
        ) : null}
      </main>

      <BottomNav />
    </div>
  );
}

function QuestionView({
  question,
  index,
  total,
  textAnswer,
  onTextChange,
  onSubmitText,
  onSelectOption,
}: {
  question: Question;
  index: number;
  total: number;
  textAnswer: string;
  onTextChange: (v: string) => void;
  onSubmitText: (e: React.FormEvent) => void;
  onSelectOption: (option: string) => void;
}) {
  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          Question {index + 1} of {total}
        </p>
        <h2 className="mt-2 text-2xl font-semibold leading-tight">
          {question.text}
        </h2>
      </div>

      {question.type === "multiple_choice" && question.options ? (
        <div className="flex flex-col gap-3">
          {question.options.map((option, i) => (
            <button
              key={option}
              onClick={() => onSelectOption(option)}
              className="flex min-h-16 items-center gap-4 rounded-xl border bg-card px-5 py-4 text-left text-base font-medium transition-colors hover:bg-accent active:bg-accent"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {LETTERS[i]}
              </span>
              {option}
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={onSubmitText} className="flex flex-col gap-3">
          <Input
            placeholder="Type your answer…"
            value={textAnswer}
            onChange={(e) => onTextChange(e.target.value)}
            autoComplete="off"
            autoFocus
          />
          <Button type="submit" size="lg" className="w-full" disabled={!textAnswer.trim()}>
            Submit
          </Button>
        </form>
      )}
    </div>
  );
}
