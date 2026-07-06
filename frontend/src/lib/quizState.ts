export type QuestionType = "text" | "multiple_choice";

export interface Question {
  id: number;
  text: string;
  type: QuestionType;
  options?: string[];
}

export interface PlayerAnswer {
  username: string;
  answer: string;
}

export interface PlayerMark {
  username: string;
  correct: boolean;
}

export type EntryState = "open" | "closed" | "finalized";

// Admins run the quiz and use /admin instead of the player /quiz page.
export const ADMIN_USERNAMES = ["finn", "james"];

export function isAdmin(username: string): boolean {
  return ADMIN_USERNAMES.includes(username.toLowerCase());
}

// Replace with questions fetched from the backend later.
export const MOCK_QUESTIONS: Question[] = [
  {
    id: 1,
    text: "What is the capital of France?",
    type: "multiple_choice",
    options: ["London", "Berlin", "Paris", "Madrid"],
  },
  {
    id: 2,
    text: "Who painted the Mona Lisa?",
    type: "text",
  },
  {
    id: 3,
    text: "Which planet is closest to the Sun?",
    type: "multiple_choice",
    options: ["Venus", "Mercury", "Earth", "Mars"],
  },
  {
    id: 4,
    text: "In what year did World War II end?",
    type: "text",
  },
  {
    id: 5,
    text: "What is the largest ocean on Earth?",
    type: "multiple_choice",
    options: ["Atlantic", "Indian", "Arctic", "Pacific"],
  },
  {
    id: 6,
    text: "What is the chemical symbol for gold?",
    type: "multiple_choice",
    options: ["Go", "Gd", "Au", "Ag"],
  },
  {
    id: 7,
    text: "How many continents are there on Earth?",
    type: "text",
  },
  {
    id: 8,
    text: "Which country hosted the 2016 Summer Olympics?",
    type: "multiple_choice",
    options: ["China", "Brazil", "Greece", "Japan"],
  },
  {
    id: 9,
    text: "Who wrote the play 'Romeo and Juliet'?",
    type: "text",
  },
  {
    id: 10,
    text: "What is the tallest mountain in the world?",
    type: "multiple_choice",
    options: ["K2", "Kilimanjaro", "Mount Everest", "Denali"],
  },
  {
    id: 11,
    text: "What is the largest planet in our solar system?",
    type: "multiple_choice",
    options: ["Saturn", "Jupiter", "Neptune", "Earth"],
  },
  {
    id: 12,
    text: "In which year did the first man walk on the Moon?",
    type: "text",
  },
  {
    id: 13,
    text: "What is the smallest prime number?",
    type: "multiple_choice",
    options: ["0", "1", "2", "3"],
  },
  {
    id: 14,
    text: "Which language has the most native speakers worldwide?",
    type: "multiple_choice",
    options: ["English", "Hindi", "Spanish", "Mandarin Chinese"],
  },
  {
    id: 15,
    text: "What is the currency used in Japan?",
    type: "text",
  },
  {
    id: 16,
    text: "Which element has the atomic number 1?",
    type: "multiple_choice",
    options: ["Helium", "Hydrogen", "Oxygen", "Carbon"],
  },
  {
    id: 17,
    text: "How many sides does a hexagon have?",
    type: "text",
  },
  {
    id: 18,
    text: "Which artist is known for the painting 'The Starry Night'?",
    type: "multiple_choice",
    options: ["Claude Monet", "Pablo Picasso", "Vincent van Gogh", "Salvador Dalí"],
  },
  {
    id: 19,
    text: "What is the longest river in the world?",
    type: "multiple_choice",
    options: ["Amazon", "Nile", "Yangtze", "Mississippi"],
  },
  {
    id: 20,
    text: "Which gas do plants absorb from the atmosphere?",
    type: "text",
  },
  {
    id: 21,
    text: "How many players are on a standard soccer team on the field?",
    type: "multiple_choice",
    options: ["9", "10", "11", "12"],
  },
  {
    id: 22,
    text: "What is the capital of Australia?",
    type: "multiple_choice",
    options: ["Sydney", "Melbourne", "Canberra", "Perth"],
  },
  {
    id: 23,
    text: "Who developed the theory of general relativity?",
    type: "text",
  },
  {
    id: 24,
    text: "Which ocean is the smallest?",
    type: "multiple_choice",
    options: ["Indian", "Arctic", "Southern", "Atlantic"],
  },
  {
    id: 25,
    text: "What is the hardest natural substance on Earth?",
    type: "multiple_choice",
    options: ["Gold", "Iron", "Diamond", "Quartz"],
  },
  {
    id: 26,
    text: "In which country would you find the Great Pyramid of Giza?",
    type: "text",
  },
  {
    id: 27,
    text: "What is the freezing point of water in degrees Celsius?",
    type: "text",
  },
  {
    id: 28,
    text: "Which planet is known as the Red Planet?",
    type: "multiple_choice",
    options: ["Venus", "Mars", "Jupiter", "Mercury"],
  },
  {
    id: 29,
    text: "How many strings does a standard guitar have?",
    type: "multiple_choice",
    options: ["4", "5", "6", "7"],
  },
  {
    id: 30,
    text: "Who was the first President of the United States?",
    type: "text",
  },
];

// All localStorage keys. Replace reads/writes with WebSocket events once the backend is ready.
export const QUIZ_INDEX_KEY = "quizCurrentIndex";
export const QUIZ_ENTRY_STATE_KEY = "quizEntryState";
export const QUIZ_ANSWERS_KEY = "quizAnswers";
export const QUIZ_MARKS_KEY = "quizMarks";
export const QUIZ_SCORES_KEY = "quizScores";
export const QUIZ_SCORE_HISTORY_KEY = "quizScoreHistory";
export const QUIZ_SCORES_VISIBLE_KEY = "quizScoresVisible";

// --- Current question index ---

export function getQuizIndex(): number {
  if (typeof window === "undefined") return -1;
  const v = localStorage.getItem(QUIZ_INDEX_KEY);
  return v !== null ? parseInt(v, 10) : -1;
}

export function setQuizIndex(index: number): void {
  localStorage.setItem(QUIZ_INDEX_KEY, String(index));
}

// --- Entry state ---

export function getQuizEntryState(): EntryState {
  const v = localStorage.getItem(QUIZ_ENTRY_STATE_KEY);
  return (v as EntryState) ?? "open";
}

export function setQuizEntryState(state: EntryState): void {
  localStorage.setItem(QUIZ_ENTRY_STATE_KEY, state);
}

// --- Player answers ---

export function getQuizAnswers(index: number): PlayerAnswer[] {
  const raw = localStorage.getItem(QUIZ_ANSWERS_KEY);
  if (!raw) return [];
  const all = JSON.parse(raw) as Record<string, PlayerAnswer[]>;
  return all[index] ?? [];
}

export function addQuizAnswer(index: number, answer: PlayerAnswer): void {
  const raw = localStorage.getItem(QUIZ_ANSWERS_KEY);
  const all = raw ? (JSON.parse(raw) as Record<string, PlayerAnswer[]>) : {};
  const existing = all[index] ?? [];
  // Upsert: replace if the player already submitted for this question.
  all[index] = [...existing.filter((a) => a.username !== answer.username), answer];
  localStorage.setItem(QUIZ_ANSWERS_KEY, JSON.stringify(all));
}

// --- Marks ---

export function getQuizMarks(index: number): PlayerMark[] {
  const raw = localStorage.getItem(QUIZ_MARKS_KEY);
  if (!raw) return [];
  const all = JSON.parse(raw) as Record<string, PlayerMark[]>;
  return all[index] ?? [];
}

export function setQuizMarks(index: number, marks: PlayerMark[]): void {
  const raw = localStorage.getItem(QUIZ_MARKS_KEY);
  const all = raw ? (JSON.parse(raw) as Record<string, PlayerMark[]>) : {};
  all[index] = marks;
  localStorage.setItem(QUIZ_MARKS_KEY, JSON.stringify(all));
}

export function getPlayerMark(index: number, username: string): boolean | null {
  const mark = getQuizMarks(index).find((m) => m.username === username);
  return mark !== undefined ? mark.correct : null;
}

// --- Scores ---

export function getQuizScores(): Record<string, number> {
  const raw = localStorage.getItem(QUIZ_SCORES_KEY);
  return raw ? JSON.parse(raw) : {};
}

export function getQuizScoreHistory(): Array<Record<string, number>> {
  const raw = localStorage.getItem(QUIZ_SCORE_HISTORY_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function addQuizScores(marks: PlayerMark[]): void {
  const scores = getQuizScores();
  for (const mark of marks) {
    if (mark.correct) {
      scores[mark.username] = (scores[mark.username] ?? 0) + 1;
    }
  }
  localStorage.setItem(QUIZ_SCORES_KEY, JSON.stringify(scores));

  const history = getQuizScoreHistory();
  history.push({ ...scores });
  localStorage.setItem(QUIZ_SCORE_HISTORY_KEY, JSON.stringify(history));
}

// --- Scores visibility ---
// Admins toggle whether players can see the leaderboard/graph on the
// tussenstand page. Defaults to hidden until an admin shows the scores.

export function getQuizScoresVisible(): boolean {
  return localStorage.getItem(QUIZ_SCORES_VISIBLE_KEY) === "true";
}

export function setQuizScoresVisible(visible: boolean): void {
  localStorage.setItem(QUIZ_SCORES_VISIBLE_KEY, String(visible));
}

// --- Reset ---

export function resetQuiz(): void {
  [
    QUIZ_INDEX_KEY,
    QUIZ_ENTRY_STATE_KEY,
    QUIZ_ANSWERS_KEY,
    QUIZ_MARKS_KEY,
    QUIZ_SCORES_KEY,
    QUIZ_SCORE_HISTORY_KEY,
    QUIZ_SCORES_VISIBLE_KEY,
  ].forEach((key) => localStorage.removeItem(key));
}
