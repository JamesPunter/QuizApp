// Typed client for the Django backend. All shared game state now lives on the
// server (see backend/quiz/services.py::build_state); the frontend polls
// GET /api/game/state/ and calls action endpoints. Token auth: the token from
// /api/auth/join/ is kept in sessionStorage and sent as `Authorization: Token`.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const QUIZ_WINNER_MARKET = "quiz_winner";
export const QUIZ_LOSER_MARKET = "quiz_loser";
export const CHALLENGE_MARKET = "challenge";
export const STARTING_BUDGET = 1000;

// --- Store ------------------------------------------------------------------
// One coin pack (bought with a real euro via Tikkie) and the two drink prices,
// mirroring backend/quiz/models.py.
export const COIN_PACK_COINS = 50;
export const COIN_PACK_PRICE_EUR = 1;
export const STORE_SHOT_PRICE = 200;
export const STORE_SIP_PRICE = 35;

// Tikkie payment links (real money). Set these to your own Tikkie request URLs;
// override per-device via NEXT_PUBLIC_TIKKIE_* in .env.local.
export const TIKKIE_COINS_URL =
  process.env.NEXT_PUBLIC_TIKKIE_COINS_URL ?? "https://tikkie.me/pay/REPLACE-ME-1-EURO";
export const TIKKIE_PUBQUIZ_URL =
  process.env.NEXT_PUBLIC_TIKKIE_PUBQUIZ_URL ?? "https://tikkie.me/pay/REPLACE-ME-1000-EURO";

// --- Types (mirror the build_state payload) ---------------------------------

export type QuestionType = "text" | "multiple_choice" | "text_bonus";
export type EntryState = "open" | "closed" | "finalized";
export type BetStatus = "open" | "won" | "lost";
export type ChallengeStatus = "pending" | "completed" | "failed";

export interface Bet {
  id: number;
  market: string;
  selection: string;
  // Parlay picks (challenge market); empty for single-pick markets.
  selections: string[];
  amount: number;
  odds: number;
  status: BetStatus;
  payout: number;
}

export interface CurrentQuestion {
  id: number;
  index: number;
  text: string;
  type: QuestionType;
  options: string[];
  // Label above the second input for text_bonus questions ("" otherwise).
  bonus_prompt: string;
}

export interface AdminAnswer {
  username: string;
  answer: string;
  // The bonus answer + its verdict (text_bonus questions only).
  bonus_answer: string;
  mark: boolean | null;
  bonus_mark: boolean | null;
}

export interface Market {
  key: string;
  is_open: boolean;
  is_settled: boolean;
  odds: Record<string, number>;
}

export interface Settlement {
  winners: string[];
  paid_out: number;
  won_count: number;
  lost_count: number;
}

// The four slot-machine symbols; a spin wins only when all 3 reels match.
export type SlotSymbol = "coin2x" | "coin3x" | "shot" | "sip" | "jackpot";

export interface SlotResult {
  reels: SlotSymbol[];
  win: boolean;
  symbol: SlotSymbol | null;
  cost: number;
  coins_won: number;
}

export const SLOT_COSTS = [50, 100, 200] as const;

// All three minigames share the same stake tiers.
export const MINIGAME_COSTS = SLOT_COSTS;

// Crash: a live round whose multiplier climbs over time. Starting a round tells
// the client where it crashes so it can animate the climb up to the crash (and
// show it happen even after the player cashes out); the cash-out response
// carries the banked/busted outcome.
export interface CrashStart {
  active: true;
  cost: number;
  crash_point: number;
}
export interface CrashResult {
  win: boolean;
  multiplier: number;
  crash_point: number;
  cost: number;
  coins_won: number;
}
// A live crash round to resume, with server-measured elapsed time (no clock sync).
export interface CrashRoundState {
  cost: number;
  elapsed_ms: number;
  crash_point: number;
}

// Roulette: European single-zero wheel. Even-money outside bets pay 2×, the
// green 0 straight bet pays 36×.
export type RouletteBet = "red" | "black" | "even" | "odd" | "low" | "high" | "green";
export type RouletteColor = "red" | "black" | "green";

export interface RouletteResult {
  number: number;
  color: RouletteColor;
  bet: RouletteBet;
  win: boolean;
  cost: number;
  coins_won: number;
}

// A drink handed to you via the store (until you dismiss it).
export type GiftKind = "shot" | "sip";
export interface Gift {
  id: number;
  kind: GiftKind;
  from: string;
}

// A coin pack of mine still waiting on a quizmaster's confirmation.
export interface PendingPurchase {
  id: number;
  coins: number;
}

// Admin-side view of a coin pack awaiting confirmation.
export interface AdminPurchase {
  id: number;
  username: string;
  coins: number;
}

// A shot/slok I landed on the slot machine, awaiting the quizmaster's
// confirmation that I've drunk it. While one is pending my machine is locked.
export interface SlotLock {
  kind: GiftKind;
}

// Admin-side view of a slot drink awaiting confirmation.
export interface AdminSlotDrink {
  id: number;
  username: string;
  kind: GiftKind;
  cost: number;
}

// One line of the admin-only live activity feed (bets / minigames / store).
export type ActivityKind = "bet" | "minigame" | "purchase" | "gift";
export interface ActivityEvent {
  id: number;
  username: string;
  kind: ActivityKind;
  text: string;
  created_at: string;
}

export interface GameState {
  current_index: number;
  entry_state: EntryState;
  scores_visible: boolean;
  total_questions: number;
  question: CurrentQuestion | null;
  you: {
    username: string;
    is_admin: boolean;
    my_answer: string | null;
    my_bonus_answer: string | null;
    my_mark: boolean | null;
    my_bonus_mark: boolean | null;
    budget: number | null;
    my_bets: Bet[];
    // Store: drinks handed to me + my coin pack awaiting confirmation.
    gifts_received: Gift[];
    pending_purchase: PendingPurchase | null;
    // A slot drink awaiting the quizmaster's OK, which locks my slot machine
    // until confirmed; null when the machine is free to spin.
    slot_lock: SlotLock | null;
    // A live crash round to resume (server-measured elapsed), else null.
    crash_round: CrashRoundState | null;
  };
  scores: Record<string, number>;
  score_history: Array<Record<string, number>>;
  roster: string[];
  budgets: Record<string, number>;
  // Coins entering each round that has started (1-based round number), for the
  // budget-over-rounds graph. Empty until the first round opens.
  budget_history: Array<{ round: number; budgets: Record<string, number> }>;
  markets: Market[];
  challenge: {
    statuses: Record<string, ChallengeStatus>;
    factor: number;
  };
  answers: AdminAnswer[];
  // Coin packs awaiting admin confirmation (admin only; [] for players).
  pending_purchases: AdminPurchase[];
  // Slot drinks awaiting admin confirmation (admin only; [] for players).
  pending_slot_drinks: AdminSlotDrink[];
  // Live feed of player actions (admin only; [] for players).
  activity: ActivityEvent[];
  // The fixed cast and who's currently online (for the admin presence panel).
  players: string[];
  present: string[];
  // Only present on the settle response.
  settlement?: Settlement | null;
  // Only present on the slot-spin response.
  spin?: SlotResult | null;
  // Present on the crash start response (CrashStart) and cash-out response
  // (CrashResult); the two are distinguished by the `win`/`active` fields.
  crash?: CrashStart | CrashResult | null;
  // Only present on the roulette-spin response.
  roulette?: RouletteResult | null;
}

export interface ClaimResponse {
  token: string;
  username: string;
  is_admin: boolean;
}

export interface RosterEntry {
  name: string;
  taken: boolean;
}

export interface LoginRoster {
  players: RosterEntry[];
  admins: RosterEntry[];
}

// --- Core fetch helper ------------------------------------------------------

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getToken(): string | null {
  return typeof window !== "undefined" ? sessionStorage.getItem("token") : null;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Token ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    const detail =
      (data as { detail?: string })?.detail ??
      (data as { username?: string[] })?.username?.[0] ??
      "Request failed";
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

// --- Auth -------------------------------------------------------------------

// The fixed cast + who's already claimed, for the login picker (no auth).
export function fetchLoginRoster(): Promise<LoginRoster> {
  return request<LoginRoster>("/api/auth/roster/", { auth: false });
}

// Claim a contestant name with its account password. Throws ApiError(401) on a
// wrong password, or ApiError(409) if it's live on another device.
export function claimName(name: string, password: string): Promise<ClaimResponse> {
  return request<ClaimResponse>("/api/auth/claim/", {
    method: "POST",
    body: { name, password },
    auth: false,
  });
}

// Free the current name on logout (best-effort; the heartbeat frees it anyway).
export async function releaseName(): Promise<void> {
  try {
    await request("/api/auth/release/", { method: "POST", body: {} });
  } catch {
    // ignore — logging out regardless
  }
}

// --- Player actions ---------------------------------------------------------

export function fetchGameState(): Promise<GameState> {
  return request<GameState>("/api/game/state/");
}

// `bonus` is the second answer for text_bonus questions (ignored otherwise).
export function submitAnswer(answer: string, bonus?: string): Promise<GameState> {
  return request<GameState>("/api/game/answer/", {
    method: "POST",
    body: { answer, bonus },
  });
}

export function placeBet(
  market: string,
  selection: string,
  amount: number
): Promise<GameState> {
  return request<GameState>("/api/bets/", {
    method: "POST",
    body: { market, selection, amount },
  });
}

// The challenge parlay: pick a set of players, one entry per bettor.
export function placeChallengeBet(
  selections: string[],
  amount: number
): Promise<GameState> {
  return request<GameState>("/api/bets/", {
    method: "POST",
    body: { market: CHALLENGE_MARKET, selections, amount },
  });
}

// --- Minigames --------------------------------------------------------------

// Spin the slot machine for `cost` coins (50 / 100 / 200). The returned state
// carries the roll under `spin` and reflects the new budget.
export function spinSlot(cost: number): Promise<GameState> {
  return request<GameState>("/api/minigames/slot/", {
    method: "POST",
    body: { cost },
  });
}

// Begin a live crash round for `cost` coins. Charges the stake; the returned
// state carries only `crash: { active }` (the crash point stays server-side).
export function startCrash(cost: number): Promise<GameState> {
  return request<GameState>("/api/minigames/crash/start/", {
    method: "POST",
    body: { cost },
  });
}

// Cash out the live crash round. The returned state carries the outcome under
// `crash` (CrashResult) and reflects any winnings.
export function cashoutCrash(): Promise<GameState> {
  return request<GameState>("/api/minigames/crash/cashout/", {
    method: "POST",
    body: {},
  });
}

// Spin the roulette wheel for `cost` coins on `bet`. The returned state carries
// the landed number under `roulette` and reflects the new budget.
export function playRoulette(cost: number, bet: RouletteBet): Promise<GameState> {
  return request<GameState>("/api/minigames/roulette/", {
    method: "POST",
    body: { cost, bet },
  });
}

// --- Store ------------------------------------------------------------------

// File a pending coin pack (paid via Tikkie, confirmed by a quizmaster).
export function requestCoinPurchase(): Promise<GameState> {
  return request<GameState>("/api/store/buy-coins/", { method: "POST", body: {} });
}

// Spend coins to make `recipient` (a player or quizmaster) take a shot/sip.
export function giveDrink(kind: GiftKind, recipient: string): Promise<GameState> {
  return request<GameState>("/api/store/gift/", {
    method: "POST",
    body: { kind, recipient },
  });
}

// Dismiss one of my drink notifications.
export function ackGift(id: number): Promise<GameState> {
  return request<GameState>("/api/store/gift/ack/", { method: "POST", body: { id } });
}

// --- Admin actions ----------------------------------------------------------

export function adminAdvance(index: number): Promise<GameState> {
  return request<GameState>("/api/admin/advance/", { method: "POST", body: { index } });
}

export function adminClose(): Promise<GameState> {
  return request<GameState>("/api/admin/close/", { method: "POST", body: {} });
}

export function adminMark(username: string, correct: boolean): Promise<GameState> {
  return request<GameState>("/api/admin/mark/", {
    method: "POST",
    body: { username, correct },
  });
}

// Mark the bonus answer of a text_bonus question, independent of the main mark.
export function adminMarkBonus(username: string, bonus: boolean): Promise<GameState> {
  return request<GameState>("/api/admin/mark/", {
    method: "POST",
    body: { username, bonus },
  });
}

export function adminFinalize(): Promise<GameState> {
  return request<GameState>("/api/admin/finalize/", { method: "POST", body: {} });
}

export function adminScoresVisible(visible: boolean): Promise<GameState> {
  return request<GameState>("/api/admin/scores-visible/", {
    method: "POST",
    body: { visible },
  });
}

export function adminMarket(key: string, open: boolean): Promise<GameState> {
  return request<GameState>("/api/admin/market/", {
    method: "POST",
    body: { key, open },
  });
}

export function adminSettle(key: string = QUIZ_WINNER_MARKET): Promise<GameState> {
  return request<GameState>("/api/admin/settle/", { method: "POST", body: { key } });
}

export function adminDeclareChallenge(
  username: string,
  status: ChallengeStatus
): Promise<GameState> {
  return request<GameState>("/api/admin/challenge/", {
    method: "POST",
    body: { username, status },
  });
}

// Commit a batch of drafted challenge verdicts at once. Only now are the
// statuses made official and any pending challenge bets settled.
export function adminSaveChallenges(
  statuses: Record<string, ChallengeStatus>
): Promise<GameState> {
  return request<GameState>("/api/admin/challenge/save/", {
    method: "POST",
    body: { statuses },
  });
}

export function adminReset(): Promise<GameState> {
  return request<GameState>("/api/admin/reset/", { method: "POST", body: {} });
}

// Confirm a coin pack was paid via Tikkie and credit the coins.
export function adminConfirmPurchase(id: number): Promise<GameState> {
  return request<GameState>("/api/admin/confirm-purchase/", {
    method: "POST",
    body: { id },
  });
}

// Confirm a player has done the shot/slok they landed on the slot, unlocking
// their machine.
export function adminConfirmSlotDrink(id: number): Promise<GameState> {
  return request<GameState>("/api/admin/confirm-slot-drink/", {
    method: "POST",
    body: { id },
  });
}
