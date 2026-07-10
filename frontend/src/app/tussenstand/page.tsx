"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Trophy, Eye, EyeOff, Lock, Coins } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import UsernameBadge from "@/components/UsernameBadge";
import LiveQuestionBanner from "@/components/LiveQuestionBanner";
import { useGameState } from "@/lib/useGameState";
import { adminScoresVisible, releaseName } from "@/lib/api";

// Validated categorical palette (dataviz skill reference instance): eight hues,
// CVD-safe in fixed order, stepped separately for the dark surface. One slot per
// player of the fixed eight-strong cast. Colour follows the player (their slot in
// the sorted roster), never their rank, so a line keeps its colour as ranks move.
const SERIES_LIGHT = [
  "#2a78d6", "#1baf7a", "#eda100", "#008300",
  "#4a3aa7", "#e34948", "#e87ba4", "#eb6834",
];
const SERIES_DARK = [
  "#3987e5", "#199e70", "#c98500", "#008300",
  "#9085e9", "#e66767", "#d55181", "#d95926",
];
const SERIES_STYLE = `
.ts-viz {
${SERIES_LIGHT.map((c, i) => `  --s${i}: ${c};`).join("\n")}
}
.dark .ts-viz {
${SERIES_DARK.map((c, i) => `  --s${i}: ${c};`).join("\n")}
}`;

const STARTING_BUDGET = 1000;

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
  const canSeeScores = admin || scoresVisible;
  const live = !admin && state.current_index >= 0 && state.entry_state === "open";

  // Stable colour ordering: a player's slot is its position in the sorted cast,
  // so both graphs (and their legends) paint each player the same colour.
  const players = state.roster;
  const colorOf = (player: string) =>
    `var(--s${players.indexOf(player) % SERIES_LIGHT.length})`;

  const scoreEntries = Object.entries(state.scores)
    .sort(([, a], [, b]) => b - a)
    .map(([name, score], i) => ({ rank: i + 1, name, score }));

  const budgetEntries = Object.entries(state.budgets)
    .map(([name, budget]) => ({ name, budget }))
    .sort((a, b) => b.budget - a.budget);

  // Scores over rounds: a round-0 baseline of all zeros (so the graph is drawn
  // even before anyone scores), then the cumulative score after each round.
  const scorePoints = [
    { label: "0", values: Object.fromEntries(players.map((p) => [p, 0])) },
    ...state.score_history.map((snap, i) => ({
      label: String(i + 1),
      values: Object.fromEntries(players.map((p) => [p, snap[p] ?? 0])),
    })),
  ];

  // Budget over rounds: coins at the start of each round. The first snapshot is
  // the initial 1000 each; before any round opens, synthesise that baseline so
  // the graph is drawn from the start.
  const budgetPoints = state.budget_history.length
    ? state.budget_history.map((h) => ({
        label: String(h.round),
        values: Object.fromEntries(
          players.map((p) => [p, h.budgets[p] ?? STARTING_BUDGET]),
        ),
      }))
    : [
        {
          label: "1",
          values: Object.fromEntries(
            players.map((p) => [p, state.budgets[p] ?? STARTING_BUDGET]),
          ),
        },
      ];

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <style>{SERIES_STYLE}</style>
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
                  <ol className="space-y-2">
                    {scoreEntries.map(({ rank, name, score }) => (
                      <RankRow
                        key={name}
                        rank={rank}
                        name={name}
                        highlight={name === username}
                        color={colorOf(name)}
                        value={
                          <span className="text-sm font-semibold">
                            {score} {score === 1 ? "punt" : "punten"}
                          </span>
                        }
                      />
                    ))}
                  </ol>
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
                    {budgetEntries.map(({ name, budget }, i) => (
                      <RankRow
                        key={name}
                        rank={i + 1}
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

type ChartPoint = { label: string; values: Record<string, number> };

function niceScale(max: number, count = 4) {
  const m = Math.max(1, max);
  const raw = m / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  step = Math.max(1, Math.round(step));
  const niceMax = Math.ceil(m / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= niceMax + 1e-9; v += step) ticks.push(v);
  return { ticks, max: niceMax };
}

function LineChart({
  points,
  players,
  colorOf,
  highlight,
  formatY,
}: {
  points: ChartPoint[];
  players: string[];
  colorOf: (player: string) => string;
  highlight?: string;
  formatY: (v: number) => string;
}) {
  const PAD_L = 40;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 26;
  const W = 360;
  const H = 220;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const n = points.length;

  const dataMax = Math.max(
    1,
    ...points.flatMap((pt) => players.map((p) => pt.values[p] ?? 0)),
  );
  const { ticks, max: yMax } = niceScale(dataMax);

  const xOf = (i: number) =>
    n === 1 ? PAD_L + chartW / 2 : PAD_L + (i / (n - 1)) * chartW;
  const yOf = (v: number) => PAD_T + chartH - (v / yMax) * chartH;

  // Thin the x labels so a long quiz doesn't overprint them; always keep the last.
  const labelStep = Math.max(1, Math.ceil(n / 8));
  const showDots = n <= 12;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {ticks.map((v) => (
          <line
            key={`g${v}`}
            x1={PAD_L}
            y1={yOf(v)}
            x2={W - PAD_R}
            y2={yOf(v)}
            stroke="var(--border)"
            strokeWidth="1"
          />
        ))}
        {ticks.map((v) => (
          <text
            key={`t${v}`}
            x={PAD_L - 6}
            y={yOf(v) + 3.5}
            textAnchor="end"
            fontSize="10"
            fill="var(--muted-foreground)"
          >
            {formatY(v)}
          </text>
        ))}
        {points.map((pt, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text
              key={`x${i}`}
              x={xOf(i)}
              y={H - PAD_B + 16}
              textAnchor="middle"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {pt.label}
            </text>
          ) : null,
        )}
        {players.map((player) => {
          const color = colorOf(player);
          const isMe = player === highlight;
          const pts = points.map((pt, i) => ({
            x: xOf(i),
            y: yOf(pt.values[player] ?? 0),
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
                strokeWidth={isMe ? 3 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={highlight && !isMe ? 0.75 : 1}
              />
              {showDots &&
                pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={isMe ? 3.5 : 2.5} fill={color} />
                ))}
            </g>
          );
        })}
      </svg>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {players.map((player) => (
          <div
            key={player}
            className={`flex items-center gap-1.5 text-sm ${
              player === highlight ? "font-semibold" : ""
            }`}
          >
            <span
              className="inline-block h-2 w-4 rounded-full"
              style={{ backgroundColor: colorOf(player) }}
            />
            {player}
          </div>
        ))}
      </div>
    </div>
  );
}
