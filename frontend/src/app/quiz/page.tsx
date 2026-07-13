"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Clock, Timer, Lock, CheckCircle, XCircle, Coins } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import UsernameBadge from "@/components/UsernameBadge";
import ChallengeInfoButton from "@/components/ChallengeInfoButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useGameState } from "@/lib/useGameState";
import {
  SeriesStyle,
  seriesColorOf,
  LineChart,
  buildBudgetPoints,
} from "@/components/StandingsCharts";
import { releaseName, submitAnswer, type CurrentQuestion } from "@/lib/api";

const LETTERS = ["A", "B", "C", "D"];

export default function QuizPage() {
  const router = useRouter();
  const { state, setState } = useGameState();
  const [textAnswer, setTextAnswer] = useState("");
  const [bonusAnswer, setBonusAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Admins run the quiz from /admin.
  useEffect(() => {
    if (state?.you.is_admin) router.replace("/admin");
  }, [state?.you.is_admin, router]);

  // Clear the draft when the question changes.
  const questionId = state?.question?.id ?? null;
  useEffect(() => {
    setTextAnswer("");
    setBonusAnswer("");
    setError(null);
  }, [questionId]);

  function handleLogout() {
    releaseName().finally(() => {
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("username");
      router.push("/login");
    });
  }

  async function submit(answer: string, bonus?: string) {
    setError(null);
    try {
      const fresh = await submitAnswer(answer, bonus);
      setState(fresh); // instant "submitted" without waiting for the next poll
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kon niet indienen.");
    }
  }

  if (!state) return null;

  const { current_index, entry_state, question } = state;
  const username = state.you.username;
  const myAnswer = state.you.my_answer;
  const myMark = state.you.my_mark;
  const myBonusMark = state.you.my_bonus_mark;
  // Bonus questions score 2 (main + bonus correct) or 1 (main only); others 1.
  const pointsWon = myMark ? (myBonusMark ? 2 : 1) : 0;

  // Once the quizmaster has done all three end-of-quiz payouts (and the quiz is on
  // its last question), the final coins standings are published here on every
  // player's homepage.
  if (state.results_published && current_index === state.total_questions - 1) {
    return (
      <div className="flex min-h-screen flex-col bg-background pb-20">
        <header className="flex items-center justify-between px-2 py-2">
          <UsernameBadge username={username} />
          <button
            onClick={handleLogout}
            aria-label="Uitloggen"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
          >
            <LogOut className="h-6 w-6" />
          </button>
        </header>
        <FinalStandings
          budgets={state.budgets}
          me={username}
          roster={state.roster}
          budgetHistory={state.budget_history}
        />
        <BottomNav giftsCount={state.you.gifts_received?.length ?? 0} />
      </div>
    );
  }

  // Full-screen result once the admin finalizes.
  if (entry_state === "finalized" && current_index >= 0) {
    if (myAnswer === null) {
      return (
        <div className="flex min-h-screen flex-col bg-background pb-20">
          <header className="flex items-center px-2 py-2">
            <UsernameBadge username={username} />
          </header>
          <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
            <XCircle className="h-16 w-16" />
            <p className="text-xl font-medium">Geen antwoord ingediend</p>
          </main>
          <BottomNav giftsCount={state.you.gifts_received?.length ?? 0} />
        </div>
      );
    }
    return (
      <div className={`flex min-h-screen flex-col pb-20 ${myMark ? "bg-green-500" : "bg-red-500"}`}>
        <header className="flex items-center px-2 py-2">
          <UsernameBadge username={username} className="text-white/90" />
        </header>
        <main className="flex flex-1 flex-col items-center justify-center gap-4 text-white">
          {myMark ? (
            <>
              <CheckCircle className="h-24 w-24" />
              <h1 className="text-5xl font-bold">Goed!</h1>
              <p className="text-xl opacity-90">
                +{pointsWon} {pointsWon === 1 ? "punt" : "punten"}
              </p>
              {myBonusMark === false && (
                <p className="text-base opacity-80">Bonus niet goed</p>
              )}
            </>
          ) : (
            <>
              <XCircle className="h-24 w-24" />
              <h1 className="text-5xl font-bold">Fout</h1>
            </>
          )}
        </main>
        <BottomNav giftsCount={state.you.gifts_received?.length ?? 0} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="flex items-center justify-between px-2 py-2">
        <UsernameBadge username={username} />
        <div className="flex items-center gap-1">
          <ChallengeInfoButton challenge={state.you.my_challenge} />
          <button
            onClick={handleLogout}
            aria-label="Uitloggen"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
          >
            <LogOut className="h-6 w-6" />
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center p-8">
        {current_index === -1 ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <Clock className="h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">Wachten op de volgende vraag…</p>
          </div>
        ) : myAnswer !== null ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <Timer className="h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">Antwoord ingediend!</p>
            <p className="text-sm text-muted-foreground">Jouw antwoord: “{myAnswer}”</p>
            <p className="text-sm text-muted-foreground">Wachten op de uitslag…</p>
          </div>
        ) : entry_state === "closed" ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <Lock className="h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">Inzenden is gesloten.</p>
            <p className="text-sm text-muted-foreground">Wachten op de uitslag…</p>
          </div>
        ) : question ? (
          <QuestionView
            question={question}
            total={state.total_questions}
            textAnswer={textAnswer}
            bonusAnswer={bonusAnswer}
            error={error}
            onTextChange={setTextAnswer}
            onBonusChange={setBonusAnswer}
            onSubmitText={(e) => {
              e.preventDefault();
              if (textAnswer.trim())
                submit(
                  textAnswer.trim(),
                  question.type === "text_bonus" ? bonusAnswer.trim() : undefined
                );
            }}
            onSelectOption={(option) => submit(option)}
          />
        ) : null}
      </main>

      <BottomNav giftsCount={state.you.gifts_received?.length ?? 0} />
    </div>
  );
}

// Standard competition ranking ("1224"): entries tied on `value` share a rank.
// `entries` must already be sorted by value descending.
function rankEntries<T extends { value: number }>(entries: T[]): (T & { rank: number })[] {
  let rank = 0;
  let prev: number | null = null;
  return entries.map((e, i) => {
    if (prev === null || e.value !== prev) rank = i + 1;
    prev = e.value;
    return { ...e, rank };
  });
}

// The published end-of-quiz screen on every player's homepage: the coins line
// graph over the quiz (ending on an "eind" point that includes the final
// payouts) plus the final coins ranking.
function FinalStandings({
  budgets,
  me,
  roster,
  budgetHistory,
}: {
  budgets: Record<string, number>;
  me: string;
  roster: string[];
  budgetHistory: Array<{ round: number; budgets: Record<string, number> }>;
}) {
  const colorOf = seriesColorOf(roster);
  const budgetPoints = buildBudgetPoints(roster, budgetHistory, budgets, "eind");
  const budgetRows = rankEntries(
    Object.entries(budgets)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
  );

  return (
    <main className="ts-viz flex flex-1 flex-col items-center gap-6 p-6">
      <SeriesStyle />
      <h1 className="text-2xl font-semibold">Einduitslag</h1>

      <ChartCard>
        <LineChart
          points={budgetPoints}
          players={roster}
          colorOf={colorOf}
          highlight={me}
          formatY={(v) => String(v)}
        />
      </ChartCard>

      <StandingsList
        icon={<Coins className="h-5 w-5 text-amber-600" />}
        title="Coins"
        rows={budgetRows}
        me={me}
        renderValue={({ value }) => (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
            <Coins className="h-4 w-4" />
            {value}
          </span>
        )}
      />
    </main>
  );
}

function ChartCard({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-sm rounded-lg border bg-card p-3">{children}</div>;
}

function StandingsList({
  icon,
  title,
  rows,
  me,
  renderValue,
}: {
  icon: React.ReactNode;
  title: string;
  rows: Array<{ name: string; value: number; rank: number }>;
  me: string;
  renderValue: (row: { name: string; value: number }) => React.ReactNode;
}) {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-2 flex items-center gap-1.5 font-medium">
        {icon}
        {title}
      </div>
      <ol className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.name}
            className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
              row.name === me ? "border-primary/40 bg-primary/5" : "bg-card"
            }`}
          >
            <span className="w-6 shrink-0 text-sm font-bold text-muted-foreground">
              #{row.rank}
            </span>
            <span className="flex-1 font-medium">{row.name}</span>
            {renderValue(row)}
          </li>
        ))}
      </ol>
    </div>
  );
}

function QuestionView({
  question,
  total,
  textAnswer,
  bonusAnswer,
  error,
  onTextChange,
  onBonusChange,
  onSubmitText,
  onSelectOption,
}: {
  question: CurrentQuestion;
  total: number;
  textAnswer: string;
  bonusAnswer: string;
  error: string | null;
  onTextChange: (v: string) => void;
  onBonusChange: (v: string) => void;
  onSubmitText: (e: React.FormEvent) => void;
  onSelectOption: (option: string) => void;
}) {
  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          Vraag {question.index + 1} van {total}
        </p>
        <h2 className="mt-2 text-2xl font-semibold leading-tight">{question.text}</h2>
      </div>

      {question.type === "multiple_choice" && question.options.length > 0 ? (
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
            placeholder="Typ je antwoord…"
            value={textAnswer}
            onChange={(e) => onTextChange(e.target.value)}
            autoComplete="off"
            autoFocus
          />
          {question.type === "text_bonus" && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-muted-foreground">
                {question.bonus_prompt || "Bonusvraag"}
              </p>
              <Input
                placeholder="Bonusantwoord…"
                value={bonusAnswer}
                onChange={(e) => onBonusChange(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={!textAnswer.trim()}>
            Indienen
          </Button>
        </form>
      )}

      {error && <p className="text-center text-sm text-red-500">{error}</p>}
    </div>
  );
}
