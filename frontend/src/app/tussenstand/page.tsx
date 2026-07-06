"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Trophy, Eye, EyeOff, Lock, Coins } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import LiveQuestionBanner from "@/components/LiveQuestionBanner";
import {
  getQuizScores,
  getQuizScoreHistory,
  getQuizScoresVisible,
  setQuizScoresVisible,
  isAdmin,
  QUIZ_SCORES_KEY,
  QUIZ_SCORE_HISTORY_KEY,
  QUIZ_SCORES_VISIBLE_KEY,
} from "@/lib/quizState";
import {
  getKnownPlayers,
  getBudget,
  registerPlayer,
  QUIZ_BUDGETS_KEY,
  QUIZ_PLAYERS_KEY,
} from "@/lib/bettingState";

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
  const [username, setUsername] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<Array<Record<string, number>>>([]);
  const [view, setView] = useState<"leaderboard" | "chart" | "budget">(
    "leaderboard"
  );
  const [scoresVisible, setScoresVisible] = useState(false);
  const [budgets, setBudgets] = useState<Array<{ name: string; budget: number }>>(
    []
  );

  useEffect(() => {
    const stored = sessionStorage.getItem("username");
    if (!stored) {
      router.replace("/login");
      return;
    }
    if (!isAdmin(stored)) registerPlayer(stored);
    setUsername(stored);
    setScores(getQuizScores());
    setHistory(getQuizScoreHistory());
    setScoresVisible(getQuizScoresVisible());
    refreshBudgets();

    function refreshBudgets() {
      setBudgets(
        getKnownPlayers()
          .map((name) => ({ name, budget: getBudget(name) }))
          .sort((a, b) => b.budget - a.budget)
      );
    }

    function onStorage(e: StorageEvent) {
      if (e.key === QUIZ_SCORES_KEY) {
        setScores(e.newValue ? JSON.parse(e.newValue) : {});
        refreshBudgets();
      }
      if (e.key === QUIZ_SCORE_HISTORY_KEY) {
        setHistory(e.newValue ? JSON.parse(e.newValue) : []);
      }
      if (e.key === QUIZ_SCORES_VISIBLE_KEY) {
        setScoresVisible(e.newValue === "true");
      }
      if (e.key === QUIZ_BUDGETS_KEY || e.key === QUIZ_PLAYERS_KEY) {
        refreshBudgets();
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [router]);

  function toggleScoresVisible() {
    const next = !scoresVisible;
    setQuizScoresVisible(next);
    setScoresVisible(next);
  }

  function handleLogout() {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("username");
    router.push("/login");
  }

  if (!username) return null;

  const admin = isAdmin(username);
  const canSeeScores = admin || scoresVisible;

  const entries = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([name, score], i) => ({ rank: i + 1, name, score }));

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="flex items-center justify-end gap-1 px-2 py-2">
        {admin && (
          <button
            onClick={toggleScoresVisible}
            aria-label={scoresVisible ? "Hide scores from players" : "Show scores to players"}
            className={`flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
              scoresVisible
                ? "text-primary hover:bg-muted"
                : "text-muted-foreground hover:text-foreground active:bg-muted"
            }`}
          >
            {scoresVisible ? (
              <>
                <Eye className="h-5 w-5" />
                Scores shown
              </>
            ) : (
              <>
                <EyeOff className="h-5 w-5" />
                Scores hidden
              </>
            )}
          </button>
        )}
        <button
          onClick={handleLogout}
          aria-label="Logout"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
        >
          <LogOut className="h-6 w-6" />
        </button>
      </header>

      <LiveQuestionBanner />

      <main className="flex flex-1 flex-col items-center p-6">
        <h1 className="mb-4 text-2xl font-semibold">Tussenstand</h1>

        {!canSeeScores ? (
          <div className="mt-8 flex flex-col items-center gap-3 text-center text-muted-foreground">
            <Lock className="h-12 w-12" />
            <p>Scores are hidden.</p>
            <p className="text-sm">The quizmaster will reveal them soon.</p>
          </div>
        ) : (
          <>
        <div className="mb-6 flex w-full max-w-sm rounded-lg border p-1 gap-1">
          {(
            [
              ["leaderboard", "Scores"],
              ["chart", "Graph"],
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
              <p>No scores yet.</p>
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
                    {score} {score === 1 ? "pt" : "pts"}
                  </span>
                </li>
              ))}
            </ol>
          )
        ) : view === "chart" ? (
          <ScoreChart history={history} />
        ) : budgets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
            <Coins className="h-12 w-12" />
            <p>No budgets yet.</p>
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

      <BottomNav quizHref={isAdmin(username) ? "/admin" : "/quiz"} />
    </div>
  );
}

function ScoreChart({ history }: { history: Array<Record<string, number>> }) {
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
        <Trophy className="h-12 w-12" />
        <p>No data yet.</p>
      </div>
    );
  }

  const players = Array.from(
    new Set(history.flatMap((snap) => Object.keys(snap)))
  );
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
    return rounds === 1
      ? PAD_L + chartW / 2
      : PAD_L + (i / (rounds - 1)) * chartW;
  }

  function yOf(score: number) {
    return PAD_T + chartH - (score / maxScore) * chartH;
  }

  const yTicks = Array.from({ length: maxScore + 1 }, (_, i) => i);

  return (
    <div className="w-full max-w-sm">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* Grid lines */}
        {yTicks.map((v) => (
          <line
            key={v}
            x1={PAD_L}
            y1={yOf(v)}
            x2={W - PAD_R}
            y2={yOf(v)}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
        ))}

        {/* Y-axis labels */}
        {yTicks.map((v) => (
          <text
            key={v}
            x={PAD_L - 6}
            y={yOf(v) + 4}
            textAnchor="end"
            fontSize="10"
            fill="#9ca3af"
          >
            {v}
          </text>
        ))}

        {/* X-axis labels */}
        {history.map((_, i) => (
          <text
            key={i}
            x={xOf(i)}
            y={H - PAD_B + 16}
            textAnchor="middle"
            fontSize="10"
            fill="#9ca3af"
          >
            {i + 1}
          </text>
        ))}

        {/* Player lines */}
        {players.map((player, pi) => {
          const color = COLORS[pi % COLORS.length];
          const pts = history.map((snap, i) => ({
            x: xOf(i),
            y: yOf(snap[player] ?? 0),
          }));
          const d = pts
            .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
            .join(" ");
          return (
            <g key={player}>
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
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
