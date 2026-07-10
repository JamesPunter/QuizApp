// Personalized per-player challenges.
//
// MOCK: these are hard-coded client-side for now. Once challenges live on the
// backend, replace `challengeFor` with a lookup into the polled game state
// (e.g. a `challenge_text` field on the Player row) and delete this map.
export const MOCK_CHALLENGES: Record<string, string> = {
  Stein: "Drink deze ronde alleen met je niet-dominante hand.",
  Niels: "Praat een hele ronde in rijmvorm — foutje is een slok.",
  Ivar: "Noem elke speler minstens één keer bij zijn bijnaam.",
  Matta: "Sta op en juich luid bij elk goed antwoord van een ander.",
  Levi: "Geef elke ronde een compliment aan de quizmaster.",
  Sep: "Beantwoord één vraag volledig in het Engels.",
  Max: "Neem een slok elke keer als jij 'ehh' zegt.",
  Tris: "Doe een high-five met iedereen voordat de volgende vraag start.",
};

// The mock challenge text for a player, with a graceful fallback for anyone
// (e.g. a new name) not in the map.
export function challengeFor(name: string): string {
  return MOCK_CHALLENGES[name] ?? "Nog geen challenge toegewezen.";
}
