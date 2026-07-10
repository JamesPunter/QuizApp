"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Trophy, Eye, EyeOff, Lock, Coins } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import UsernameBadge from "@/components/UsernameBadge";
import LiveQuestionBanner from "@/components/LiveQuestionBanner";
import { useGameState } from "@/lib/useGameState";
import { adminScoresVisible, releaseName } from "@/lib/api";

const COLORS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#ec4899",
];

export default function TussenstandPage() {
  const router = useRouter();
  const { state, setState } = useGameState();
  const [view, setView] = useState<"leaderboard" | "chart" | "budget">("leaderboard");
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
  const canSeeScores = admin || scoresVisible;
  const live = !admin && state.current_index >= 0 && state.entry_state === "open";

  const entries = Object.entries(state.scores)
    .sort(([, a], [, b]) => b - a)
    .map(([name, score], i) => ({ rank: i + 1, name, score }));

  const budgets = Object.entries(state.budgets)
    .map(([name, budget]) => ({ name, budget }))
    .sort((a, b) => b.budget - a.budget);

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="flex items-center justify-between gap-1 px-2 py-2">
        <UsernameBadge username={username} />
        <div className="flex items-center gap-1">
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
          <>
            <div className="mb-6 flex w-full max-w-sm rounded-lg border p-1 gap-1">
              {(
                [
                  ["leaderboard", "Scores"],
                  ["chart", "Grafiek"],
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

            {view === "leaderboard" ? (
              entries.length === 0 ? (
                <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
                  <Trophy className="h-12 w-12" />
                  <p>Nog geen scores.</p>
                </div>
              ) : (
                <ol className="w-full max-w-sm space-y-2">
                  {entries.map(({ rank, name, score }) => (
                    <li
                      key={name}
                      className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
                        name === username ? "border-primary/40 bg-primary/5" : "bg-card"
                      }`}
                    >
                      <span className="w-6 shrink-0 text-sm font-bold text-muted-foreground">
                        #{rank}
                      </span>
                      <span className="flex-1 font-medium">{name}</span>
                      <span className="text-sm font-semibold">
                        {score} {score === 1 ? "punt" : "punten"}
                      </span>
                    </li>
                  ))}
                </ol>
              )
            ) : view === "chart" ? (
              <ScoreChart history={state.score_history} />
            ) : budgets.length === 0 ? (
              <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
                <Coins className="h-12 w-12" />
                <p>Nog geen budgetten.</p>
              </div>
            ) : (
              <ol className="w-full max-w-sm space-y-2">
                {budgets.map(({ name, budget }, i) => (
                  <li
                    key={name}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
                      name === username ? "border-primary/40 bg-primary/5" : "bg-card"
                    }`}
                  >
                    <span className="w-6 shrink-0 text-sm font-bold text-muted-foreground">
                      #{i + 1}
                    </span>
                    <span className="flex-1 font-medium">{name}</span>
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                      <Coins className="h-4 w-4" />
                      {budget}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </main>

      <BottomNav
        quizHref={admin ? "/admin" : "/quiz"}
        giftsCount={state.you.gifts_received?.length ?? 0}
        isAdmin={admin}
        activityCount={state.pending_purchases?.length ?? 0}
      />
    </div>
  );
}

function ScoreChart({ history }: { history: Array<Record<string, number>> }) {
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
        <Trophy className="h-12 w-12" />
        <p>Nog geen gegevens.</p>
      </div>
    );
  }

  const players = Array.from(new Set(history.flatMap((snap) => Object.keys(snap))));
  const maxScore = Math.max(...history.map((snap) => Math.max(...Object.values(snap))), 1);
  const rounds = history.length;

  const PAD_L = 32;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 28;
  const W = 360;
  const H = 220;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  function xOf(i: number) {
    return rounds === 1 ? PAD_L + chartW / 2 : PAD_L + (i / (rounds - 1)) * chartW;
  }

  function yOf(score: number) {
    return PAD_T + chartH - (score / maxScore) * chartH;
  }

  const yTicks = Array.from({ length: maxScore + 1 }, (_, i) => i);

  return (
    <div className="w-full max-w-sm">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {yTicks.map((v) => (
          <line key={v} x1={PAD_L} y1={yOf(v)} x2={W - PAD_R} y2={yOf(v)} stroke="#e5e7eb" strokeWidth="1" />
        ))}
        {yTicks.map((v) => (
          <text key={v} x={PAD_L - 6} y={yOf(v) + 4} textAnchor="end" fontSize="10" fill="#9ca3af">
            {v}
          </text>
        ))}
        {history.map((_, i) => (
          <text key={i} x={xOf(i)} y={H - PAD_B + 16} textAnchor="middle" fontSize="10" fill="#9ca3af">
            {i + 1}
          </text>
        ))}
        {players.map((player, pi) => {
          const color = COLORS[pi % COLORS.length];
          const pts = history.map((snap, i) => ({ x: xOf(i), y: yOf(snap[player] ?? 0) }));
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
          return (
            <g key={player}>
              <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} />
              ))}
            </g>
          );
        })}
      </svg>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {players.map((player, pi) => (
          <div key={player} className="flex items-center gap-1.5 text-sm">
            <span
              className="inline-block h-2 w-4 rounded-full"
              style={{ backgroundColor: COLORS[pi % COLORS.length] }}
            />
            {player}
          </div>
        ))}
      </div>
    </div>
  );
}
