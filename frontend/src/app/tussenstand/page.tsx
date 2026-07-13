"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Trophy, Eye, EyeOff, Lock, Coins } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import UsernameBadge from "@/components/UsernameBadge";
import ChallengeInfoButton from "@/components/ChallengeInfoButton";
import LiveQuestionBanner from "@/components/LiveQuestionBanner";
import {
  SeriesStyle,
  seriesColorOf,
  LineChart,
  buildScorePoints,
  buildBudgetPoints,
} from "@/components/StandingsCharts";
import { useGameState } from "@/lib/useGameState";
import { adminScoresVisible, releaseName } from "@/lib/api";

// Standard competition ranking ("1224"): players tied on the ranked value share
// the same position, and the next distinct value resumes at its absolute index.
// `items` must already be sorted by `valueOf` descending.
function withRanks<T>(items: T[], valueOf: (t: T) => number): (T & { rank: number })[] {
  let rank = 0;
  let prev: number | null = null;
  return items.map((item, i) => {
    const v = valueOf(item);
    if (prev === null || v !== prev) rank = i + 1;
    prev = v;
    return { ...item, rank };
  });
}

export default function TussenstandPage() {
  const router = useRouter();
  const { state, setState } = useGameState();
  const [view, setView] = useState<"scores" | "budget">("scores");
  const [busy, setBusy] = useState(false);

  async function toggleScoresVisible() {
    if (!state || busy) return;
    setBusy(true);
    try {
      setState(await adminScoresVisible(!state.scores_visible));
    } finally {
      setBusy(false);
    }
  }

  function handleLogout() {
    releaseName().finally(() => {
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("username");
      router.push("/login");
    });
  }

  if (!state) return null;

  const username = state.you.username;
  const admin = state.you.is_admin;
  const scoresVisible = state.scores_visible;
  // Admins always; players once the quizmaster reveals scores or after all three
  // end-of-quiz payouts publish the final standings.
  const canSeeScores = admin || scoresVisible || state.results_published;
  const live = !admin && state.current_index >= 0 && state.entry_state === "open";

  // Stable colour ordering: a player's slot is its position in the sorted cast,
  // so both graphs (and their legends) paint each player the same colour.
  const players = state.roster;
  const colorOf = seriesColorOf(players);

  const scoreEntries = withRanks(
    Object.entries(state.scores)
      .sort(([, a], [, b]) => b - a)
      .map(([name, score]) => ({ name, score })),
    (e) => e.score,
  );

  // End-of-quiz coins a player earns for their finishing position. While the
  // quiz runs this is the live preview ("if it ended now"); once the last
  // question is scored it's the recorded final payout.
  const rr = state.rank_rewards;
  const rewardOf = (name: string): number | undefined => {
    if (rr?.awarded) return rr.results.find((r) => r.username === name)?.coins;
    return rr?.preview?.[name];
  };

  const budgetEntries = withRanks(
    Object.entries(state.budgets)
      .map(([name, budget]) => ({ name, budget }))
      .sort((a, b) => b.budget - a.budget),
    (e) => e.budget,
  );

  const scorePoints = buildScorePoints(players, state.score_history);
  // When the quiz is over, append a final "eind" point so the end-of-quiz coin
  // payouts show up as the last step of the budget graph.
  const budgetPoints = buildBudgetPoints(
    players,
    state.budget_history,
    state.budgets,
    state.results_published ? "eind" : undefined,
  );

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <SeriesStyle />
      <header className="flex items-center justify-between gap-1 px-2 py-2">
        <UsernameBadge username={username} />
        <div className="flex items-center gap-1">
        {!admin && <ChallengeInfoButton challenge={state.you.my_challenge} />}
        {admin && (
          <button
            onClick={toggleScoresVisible}
            disabled={busy}
            aria-label={scoresVisible ? "Scores verbergen voor spelers" : "Scores tonen aan spelers"}
            className={`flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
              scoresVisible
                ? "text-primary hover:bg-muted"
                : "text-muted-foreground hover:text-foreground active:bg-muted"
            }`}
          >
            {scoresVisible ? (
              <>
                <Eye className="h-5 w-5" />
                Scores zichtbaar
              </>
            ) : (
              <>
                <EyeOff className="h-5 w-5" />
                Scores verborgen
              </>
            )}
          </button>
        )}
        <button
          onClick={handleLogout}
          aria-label="Uitloggen"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
        >
          <LogOut className="h-6 w-6" />
        </button>
        </div>
      </header>

      <LiveQuestionBanner live={live} />

      <main className="flex flex-1 flex-col items-center p-6">
        <h1 className="mb-4 text-2xl font-semibold">Tussenstand</h1>

        {!canSeeScores ? (
          <div className="mt-8 flex flex-col items-center gap-3 text-center text-muted-foreground">
            <Lock className="h-12 w-12" />
            <p>De scores zijn verborgen.</p>
            <p className="text-sm">De quizmaster laat ze straks zien.</p>
          </div>
        ) : (
          <div className="w-full max-w-sm">
            <div className="mb-6 flex w-full rounded-lg border p-1 gap-1">
              {(
                [
                  ["scores", "Scores"],
                  ["budget", "Budget"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setView(value)}
                  className={`h-11 flex-1 rounded-md px-3 text-sm font-medium transition-colors ${
                    view === value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground active:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {view === "scores" ? (
              <Section
                icon={<Trophy className="h-12 w-12" />}
                emptyLabel="Nog geen scores."
                ranking={
                  <div className="space-y-2">
                    <p className="px-1 text-xs text-muted-foreground">
                      {rr?.awarded
                        ? "De quiz is afgelopen — dit zijn de coins die iedereen kreeg voor zijn eindpositie."
                        : "Coins die je positie oplevert als de quiz nu zou stoppen. De laatste plek levert coins in."}
                    </p>
                    <ol className="space-y-2">
                      {scoreEntries.map(({ rank, name, score }) => (
                        <RankRow
                          key={name}
                          rank={rank}
                          name={name}
                          highlight={name === username}
                          color={colorOf(name)}
                          value={
                            <div className="flex items-center gap-2.5">
                              <span className="text-sm font-semibold">
                                {score} {score === 1 ? "punt" : "punten"}
                              </span>
                              <CoinDelta coins={rewardOf(name)} />
                            </div>
                          }
                        />
                      ))}
                    </ol>
                  </div>
                }
                chart={
                  <LineChart
                    points={scorePoints}
                    players={players}
                    colorOf={colorOf}
                    highlight={username}
                    formatY={(v) => String(v)}
                  />
                }
                empty={scoreEntries.length === 0}
              />
            ) : (
              <Section
                icon={<Coins className="h-12 w-12" />}
                emptyLabel="Nog geen budgetten."
                ranking={
                  <ol className="space-y-2">
                    {budgetEntries.map(({ name, budget, rank }) => (
                      <RankRow
                        key={name}
                        rank={rank}
                        name={name}
                        highlight={name === username}
                        color={colorOf(name)}
                        value={
                          <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                            <Coins className="h-4 w-4" />
                            {budget}
                          </span>
                        }
                      />
                    ))}
                  </ol>
                }
                chart={
                  <LineChart
                    points={budgetPoints}
                    players={players}
                    colorOf={colorOf}
                    highlight={username}
                    formatY={(v) => String(v)}
                  />
                }
                empty={budgetEntries.length === 0}
              />
            )}
          </div>
        )}
      </main>

      <BottomNav
        quizHref={admin ? "/admin" : "/quiz"}
        giftsCount={state.you.gifts_received?.length ?? 0}
        isAdmin={admin}
        activityCount={(state.pending_purchases?.length ?? 0) + (state.pending_slot_drinks?.length ?? 0)}
      />
    </div>
  );
}

function Section({
  ranking,
  chart,
  empty,
  icon,
  emptyLabel,
}: {
  ranking: React.ReactNode;
  chart: React.ReactNode;
  empty: boolean;
  icon: React.ReactNode;
  emptyLabel: string;
}) {
  if (empty) {
    return (
      <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
        {icon}
        <p>{emptyLabel}</p>
      </div>
    );
  }
  return (
    <div className="ts-viz flex flex-col gap-6">
      <div className="rounded-lg border bg-card p-3">{chart}</div>
      {ranking}
    </div>
  );
}

function RankRow({
  rank,
  name,
  value,
  highlight,
  color,
}: {
  rank: number;
  name: string;
  value: React.ReactNode;
  highlight: boolean;
  color: string;
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
        highlight ? "border-primary/40 bg-primary/5" : "bg-card"
      }`}
    >
      <span className="w-6 shrink-0 text-sm font-bold text-muted-foreground">#{rank}</span>
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="flex-1 font-medium">{name}</span>
      {value}
    </li>
  );
}

// The coins a player wins (or, when negative, is docked) for their finishing
// position, shown beside their score. Green for a reward, red for a deduction.
function CoinDelta({ coins }: { coins?: number }) {
  if (coins === undefined) return null;
  const tone =
    coins > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : coins < 0
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";
  const sign = coins > 0 ? "+" : "";
  return (
    <span className={`flex items-center gap-1 text-sm font-semibold tabular-nums ${tone}`}>
      <Coins className="h-3.5 w-3.5" />
      {sign}
      {coins}
    </span>
  );
}
