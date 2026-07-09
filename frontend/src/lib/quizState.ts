// Client-side helpers only. All game state now lives on the backend and is
// fetched via lib/api.ts + useGameState. (Historically this file held the whole
// localStorage-backed prototype.)

export type QuestionType = "text" | "multiple_choice";
export type EntryState = "open" | "closed" | "finalized";

// Admins run the quiz from /admin and never play or bet. Mirrors the backend's
// ADMIN_USERNAMES (quiz/models.py). Compared case-insensitively.
export const ADMIN_USERNAMES = ["finn", "james"];

export function isAdmin(username: string): boolean {
  return ADMIN_USERNAMES.includes(username.toLowerCase());
}
