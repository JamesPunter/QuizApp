// Betting layer for the Betje page. Like quizState, this is a localStorage-backed
// prototype that syncs across tabs via the "storage" event. Replace reads/writes
// with backend/WebSocket calls once the API is ready.

import {
  QUIZ_ANSWERS_KEY,
  getQuizScores,
  isAdmin,
  ADMIN_USERNAMES,
} from "./quizState";
import type { PlayerAnswer } from "./quizState";

// Every player starts a betting game with this many coins.
export const STARTING_BUDGET = 1000;

// Market ids. "Wie wint de quiz?" pays out at the end of the quiz. Later markets
// may settle at other moments, so each bet records which market it belongs to.
export const QUIZ_WINNER_MARKET = "quiz_winner";

export type BetStatus = "open" | "won" | "lost";

export interface Bet {
  id: string;
  bettor: string;
  market: string;
  selection: string; // e.g. the player the bettor thinks will win
  amount: number;
  odds: number; // decimal odds locked in at placement time
  status: BetStatus;
  payout: number; // coins returned when won (amount * odds), 0 otherwise
  placedAt: number;
}

export const QUIZ_BUDGETS_KEY = "quizBudgets";
export const QUIZ_BETS_KEY = "quizBets";
export const QUIZ_SETTLED_MARKETS_KEY = "quizSettledMarkets";
export const QUIZ_OPEN_MARKETS_KEY = "quizOpenMarkets";
export const QUIZ_PLAYERS_KEY = "quizPlayers";

// --- Player roster ---

// Every player is registered here the moment they join, so the betting lists
// include everyone who's in the quiz — not just people who opened the Betje
// page. Admins run the quiz and are never listed.
export function getRoster(): string[] {
  const raw = localStorage.getItem(QUIZ_PLAYERS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function registerPlayer(username: string): void {
  if (isAdmin(username)) return;
  const roster = getRoster();
  if (!roster.some((n) => n.toLowerCase() === username.toLowerCase())) {
    roster.push(username);
    localStorage.setItem(QUIZ_PLAYERS_KEY, JSON.stringify(roster));
  }
}

// --- Known players ---

// The betting participant list. The roster is the source of truth, but we also
// union in anyone that shows up in scores/answers/budgets as a safety net.
// Admins run the quiz and are never candidates or bettors.
export function getKnownPlayers(): string[] {
  const names = new Set<string>();

  getRoster().forEach((n) => names.add(n));
  Object.keys(getQuizScores()).forEach((n) => names.add(n));
  Object.keys(getBudgets()).forEach((n) => names.add(n));

  const rawAnswers = localStorage.getItem(QUIZ_ANSWERS_KEY);
  if (rawAnswers) {
    const all = JSON.parse(rawAnswers) as Record<string, PlayerAnswer[]>;
    Object.values(all).forEach((list) =>
      list.forEach((a) => names.add(a.username))
    );
  }

  return Array.from(names)
    .filter((n) => !isAdmin(n))
    .sort((a, b) => a.localeCompare(b));
}

// --- Budgets ---

export function getBudgets(): Record<string, number> {
  const raw = localStorage.getItem(QUIZ_BUDGETS_KEY);
  return raw ? JSON.parse(raw) : {};
}

export function getBudget(username: string): number {
  const budgets = getBudgets();
  return budgets[username] ?? STARTING_BUDGET;
}

export function setBudget(username: string, amount: number): void {
  const budgets = getBudgets();
  budgets[username] = amount;
  localStorage.setItem(QUIZ_BUDGETS_KEY, JSON.stringify(budgets));
}

// Make sure a player has an explicit budget entry (so they appear in the
// betting-scores tab even before placing a bet).
export function ensureBudget(username: string): void {
  if (isAdmin(username)) return;
  const budgets = getBudgets();
  if (!(username in budgets)) {
    budgets[username] = STARTING_BUDGET;
    localStorage.setItem(QUIZ_BUDGETS_KEY, JSON.stringify(budgets));
  }
}

// --- Odds ---

// Win probability from a softmax over current scores: p_i ∝ exp(score_i / T).
//
// The temperature T = sqrt(questions remaining) makes a lead count relative to
// how much quiz is left. Early on (many questions remaining) T is large, so
// scores are flattened and a 1-point lead barely moves the odds. As the quiz
// nears the end T shrinks, so leads become decisive — a lead larger than the
// questions remaining makes that player a near-certain winner. This mirrors how
// the final gap between players is uncertain by roughly sqrt(remaining) if the
// remaining questions play out like coin flips.
//
// Recomputed from the live scores, which only change when a round is finalized.
export function computeQuizWinnerOdds(
  scores: Record<string, number>,
  candidates: string[],
  questionsRemaining: number
): Record<string, number> {
  const odds: Record<string, number> = {};
  if (candidates.length === 0) return odds;

  const T = Math.max(Math.sqrt(Math.max(questionsRemaining, 0)), 0.5);

  // Subtract the max score for numerical stability (doesn't change the softmax).
  const raw = candidates.map((c) => scores[c] ?? 0);
  const maxScore = Math.max(...raw);
  const exps = raw.map((s) => Math.exp((s - maxScore) / T));
  const total = exps.reduce((a, b) => a + b, 0);

  candidates.forEach((c, i) => {
    const p = exps[i] / total;
    odds[c] = Math.max(1.05, Math.round((1 / p) * 100) / 100);
  });
  return odds;
}

// --- Market release ---

// A market is closed for betting until an admin releases it. Once released it's
// open for players to bet on (until it's settled).
export function getOpenMarkets(): string[] {
  const raw = localStorage.getItem(QUIZ_OPEN_MARKETS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function isMarketOpen(market: string): boolean {
  return getOpenMarkets().includes(market);
}

export function setMarketOpen(market: string, open: boolean): void {
  const current = getOpenMarkets();
  const next = open
    ? current.includes(market)
      ? current
      : [...current, market]
    : current.filter((m) => m !== market);
  localStorage.setItem(QUIZ_OPEN_MARKETS_KEY, JSON.stringify(next));
}

// --- Bets ---

export function getBets(): Bet[] {
  const raw = localStorage.getItem(QUIZ_BETS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function getPlayerBets(username: string): Bet[] {
  return getBets().filter((b) => b.bettor === username);
}

export interface PlaceBetInput {
  bettor: string;
  market: string;
  selection: string;
  amount: number;
  odds: number;
}

export function placeBet(input: PlaceBetInput): { ok: boolean; error?: string } {
  const { bettor, market, selection, amount, odds } = input;

  if (isAdmin(bettor)) return { ok: false, error: "Admins can't place bets." };
  if (isMarketSettled(market)) {
    return { ok: false, error: "This market has been settled." };
  }
  if (!isMarketOpen(market)) {
    return { ok: false, error: "This market isn't open for betting yet." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter an amount greater than 0." };
  }
  const budget = getBudget(bettor);
  if (amount > budget) return { ok: false, error: "Not enough budget." };

  setBudget(bettor, budget - amount);

  const bets = getBets();
  bets.push({
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + Math.random().toString(16).slice(2),
    bettor,
    market,
    selection,
    amount,
    odds,
    status: "open",
    payout: 0,
    placedAt: Date.now(),
  });
  localStorage.setItem(QUIZ_BETS_KEY, JSON.stringify(bets));
  return { ok: true };
}

// --- Settlement ---

export function getSettledMarkets(): string[] {
  const raw = localStorage.getItem(QUIZ_SETTLED_MARKETS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function isMarketSettled(market: string): boolean {
  return getSettledMarkets().includes(market);
}

function markMarketSettled(market: string): void {
  const settled = getSettledMarkets();
  if (!settled.includes(market)) {
    settled.push(market);
    localStorage.setItem(QUIZ_SETTLED_MARKETS_KEY, JSON.stringify(settled));
  }
}

// The winner(s) of the quiz: whoever has the top score (ties share the win).
export function getQuizWinners(scores: Record<string, number>): string[] {
  const entries = Object.entries(scores).filter(
    ([name]) => !ADMIN_USERNAMES.includes(name.toLowerCase())
  );
  const max = Math.max(0, ...entries.map(([, s]) => s));
  if (max <= 0) return [];
  return entries.filter(([, s]) => s === max).map(([name]) => name);
}

export interface SettlementResult {
  winners: string[];
  paidOut: number; // total coins returned to winning bettors
  wonCount: number;
  lostCount: number;
}

// Settle "Wie wint de quiz?" using the final scores. Idempotent: calling it more
// than once has no effect. Winning bets return amount * odds to the bettor.
export function settleQuizWinnerMarket(): SettlementResult | null {
  if (isMarketSettled(QUIZ_WINNER_MARKET)) return null;

  const winners = getQuizWinners(getQuizScores());
  const bets = getBets();
  const budgets = getBudgets();
  let paidOut = 0;
  let wonCount = 0;
  let lostCount = 0;

  bets.forEach((b) => {
    if (b.market !== QUIZ_WINNER_MARKET || b.status !== "open") return;
    if (winners.includes(b.selection)) {
      b.status = "won";
      b.payout = Math.round(b.amount * b.odds);
      budgets[b.bettor] = (budgets[b.bettor] ?? STARTING_BUDGET) + b.payout;
      paidOut += b.payout;
      wonCount += 1;
    } else {
      b.status = "lost";
      b.payout = 0;
      lostCount += 1;
    }
  });

  localStorage.setItem(QUIZ_BETS_KEY, JSON.stringify(bets));
  localStorage.setItem(QUIZ_BUDGETS_KEY, JSON.stringify(budgets));
  markMarketSettled(QUIZ_WINNER_MARKET);

  return { winners, paidOut, wonCount, lostCount };
}

// --- Reset ---

// Wipe the betting game (budgets, bets, settlement flags, released markets) for
// a fresh quiz. The player roster is kept: the same people are still in the quiz.
export function resetBettingGame(): void {
  [
    QUIZ_BUDGETS_KEY,
    QUIZ_BETS_KEY,
    QUIZ_SETTLED_MARKETS_KEY,
    QUIZ_OPEN_MARKETS_KEY,
  ].forEach((k) => localStorage.removeItem(k));
}
