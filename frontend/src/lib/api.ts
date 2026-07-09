// Typed client for the Django backend. All shared game state now lives on the
// server (see backend/quiz/services.py::build_state); the frontend polls
// GET /api/game/state/ and calls action endpoints. Token auth: the token from
// /api/auth/join/ is kept in sessionStorage and sent as `Authorization: Token`.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const QUIZ_WINNER_MARKET = "quiz_winner";
export const QUIZ_LOSER_MARKET = "quiz_loser";
export const CHALLENGE_MARKET = "challenge";
export const STARTING_BUDGET = 1000;

// --- Types (mirror the build_state payload) ---------------------------------

export type QuestionType = "text" | "multiple_choice";
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
}

export interface AdminAnswer {
  username: string;
  answer: string;
  mark: boolean | null;
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
    my_mark: boolean | null;
    budget: number | null;
    my_bets: Bet[];
  };
  scores: Record<string, number>;
  score_history: Array<Record<string, number>>;
  roster: string[];
  budgets: Record<string, number>;
  markets: Market[];
  challenge: {
    statuses: Record<string, ChallengeStatus>;
    factor: number;
  };
  answers: AdminAnswer[];
  // The fixed cast and who's currently online (for the admin presence panel).
  players: string[];
  present: string[];
  // Only present on the settle response.
  settlement?: Settlement | null;
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

// Claim a contestant name. Throws ApiError(409) if it's live on another device.
export function claimName(name: string): Promise<ClaimResponse> {
  return request<ClaimResponse>("/api/auth/claim/", {
    method: "POST",
    body: { name },
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

export function submitAnswer(answer: string): Promise<GameState> {
  return request<GameState>("/api/game/answer/", { method: "POST", body: { answer } });
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

export function adminReset(): Promise<GameState> {
  return request<GameState>("/api/admin/reset/", { method: "POST", body: {} });
}
