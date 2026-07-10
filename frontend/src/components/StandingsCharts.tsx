"use client";

import React from "react";

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

// Charts must live inside a `.ts-viz` container for these variables to apply.
const SERIES_STYLE = `
.ts-viz {
${SERIES_LIGHT.map((c, i) => `  --s${i}: ${c};`).join("\n")}
}
.dark .ts-viz {
${SERIES_DARK.map((c, i) => `  --s${i}: ${c};`).join("\n")}
}`;

const STARTING_BUDGET = 1000;

// Injects the series-colour CSS variables once per page.
export function SeriesStyle() {
  return <style>{SERIES_STYLE}</style>;
}

// A player's colour is its slot in the sorted cast, so graphs and legends paint
// each player the same colour everywhere.
export function seriesColorOf(players: string[]) {
  return (player: string) => {
    const i = players.indexOf(player);
    return `var(--s${(i < 0 ? 0 : i) % SERIES_LIGHT.length})`;
  };
}

export type ChartPoint = { label: string; values: Record<string, number> };

// Scores over rounds: a round-0 baseline of all zeros (so the graph is drawn even
// before anyone scores), then the cumulative score after each finalized round.
export function buildScorePoints(
  players: string[],
  scoreHistory: Array<Record<string, number>>,
): ChartPoint[] {
  return [
    { label: "0", values: Object.fromEntries(players.map((p) => [p, 0])) },
    ...scoreHistory.map((snap, i) => ({
      label: String(i + 1),
      values: Object.fromEntries(players.map((p) => [p, snap[p] ?? 0])),
    })),
  ];
}

// Coins over rounds: coins at the start of each round. Before any round opens,
// synthesise a baseline from the current budgets so the graph is drawn from the
// start. When `finalLabel` is given (quiz over), append a final point of the
// current budgets so the end-of-quiz payouts show up as the last step.
export function buildBudgetPoints(
  players: string[],
  budgetHistory: Array<{ round: number; budgets: Record<string, number> }>,
  budgets: Record<string, number>,
  finalLabel?: string,
): ChartPoint[] {
  const points: ChartPoint[] = budgetHistory.length
    ? budgetHistory.map((h) => ({
        label: String(h.round),
        values: Object.fromEntries(
          players.map((p) => [p, h.budgets[p] ?? STARTING_BUDGET]),
        ),
      }))
    : [
        {
          label: "1",
          values: Object.fromEntries(
            players.map((p) => [p, budgets[p] ?? STARTING_BUDGET]),
          ),
        },
      ];
  if (finalLabel) {
    points.push({
      label: finalLabel,
      values: Object.fromEntries(players.map((p) => [p, budgets[p] ?? STARTING_BUDGET])),
    });
  }
  return points;
}

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

export function LineChart({
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
