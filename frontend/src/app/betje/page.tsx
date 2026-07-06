"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Coins, Trophy, Lock, LockOpen } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import LiveQuestionBanner from "@/components/LiveQuestionBanner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  MOCK_QUESTIONS,
  getQuizScores,
  getQuizScoreHistory,
  isAdmin,
  QUIZ_SCORES_KEY,
  QUIZ_SCORE_HISTORY_KEY,
} from "@/lib/quizState";
import {
  QUIZ_WINNER_MARKET,
  getKnownPlayers,
  getBudget,
  ensureBudget,
  registerPlayer,
  computeQuizWinnerOdds,
  getPlayerBets,
  placeBet,
  isMarketSettled,
  isMarketOpen,
  setMarketOpen,
  QUIZ_BUDGETS_KEY,
  QUIZ_BETS_KEY,
  QUIZ_SETTLED_MARKETS_KEY,
  QUIZ_OPEN_MARKETS_KEY,
  QUIZ_PLAYERS_KEY,
} from "@/lib/bettingState";
import type { Bet } from "@/lib/bettingState";

export default function BetjePage() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [players, setPlayers] = useState<string[]>([]);
  const [budget, setBudgetState] = useState(0);
  const [bets, setBets] = useState<Bet[]>([]);
  const [settled, setSettled] = useState(false);
  const [marketOpen, setMarketOpenState] = useState(false);
  const [roundsPlayed, setRoundsPlayed] = useState(0);

  const [selection, setSelection] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((user: string) => {
    setScores(getQuizScores());
    setPlayers(getKnownPlayers());
    setBudgetState(getBudget(user));
    setBets(getPlayerBets(user));
    setSettled(isMarketSettled(QUIZ_WINNER_MARKET));
    setMarketOpenState(isMarketOpen(QUIZ_WINNER_MARKET));
    setRoundsPlayed(getQuizScoreHistory().length);
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem("username");
    if (!stored) {
      router.replace("/login");
      return;
    }
    const isAdminUser = isAdmin(stored);
    if (!isAdminUser) {
      // Make sure everyone who lands here is in the roster and has a budget.
      registerPlayer(stored);
      ensureBudget(stored);
    }
    setUsername(stored);
    setAdmin(isAdminUser);
    refresh(stored);

    function onStorage(e: StorageEvent) {
      if (
        e.key === QUIZ_SCORES_KEY ||
        e.key === QUIZ_SCORE_HISTORY_KEY ||
        e.key === QUIZ_BUDGETS_KEY ||
        e.key === QUIZ_BETS_KEY ||
        e.key === QUIZ_SETTLED_MARKETS_KEY ||
        e.key === QUIZ_OPEN_MARKETS_KEY ||
        e.key === QUIZ_PLAYERS_KEY
      ) {
        refresh(stored!);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [router, refresh]);

  function handleLogout() {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("username");
    router.push("/login");
  }

  function handleToggleMarket() {
    if (!username) return;
    setMarketOpen(QUIZ_WINNER_MARKET, !marketOpen);
    refresh(username);
  }

  const questionsRemaining = Math.max(MOCK_QUESTIONS.length - roundsPlayed, 0);
  const odds = computeQuizWinnerOdds(scores, players, questionsRemaining);

  function handlePlaceBet(e: React.FormEvent) {
    e.preventDefault();
    if (!username) return;
    setError(null);

    const sel = selection || players[0];
    if (!sel) {
      setError("No players to bet on yet.");
      return;
    }
    const amt = Math.floor(Number(amount));
    const result = placeBet({
      bettor: username,
      market: QUIZ_WINNER_MARKET,
      selection: sel,
      amount: amt,
      odds: odds[sel],
    });
    if (!result.ok) {
      setError(result.error ?? "Could not place bet.");
      return;
    }
    setAmount("");
    refresh(username);
  }

  if (!username) return null;

  const myMarketBets = bets.filter((b) => b.market === QUIZ_WINNER_MARKET);
  const selected = selection || players[0] || "";
  const amtNum = Math.floor(Number(amount));
  const potential =
    selected && odds[selected] && amtNum > 0
      ? Math.round(amtNum * odds[selected])
      : 0;

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="flex items-center justify-between px-2 py-2">
        {admin ? (
          <span className="px-3 text-sm font-medium text-muted-foreground">
            Odds board
          </span>
        ) : (
          <div className="flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-800">
            <Coins className="h-4 w-4" />
            {budget} coins
          </div>
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

      <main className="flex flex-1 flex-col items-center gap-6 p-6">
        <h1 className="text-2xl font-semibold">Betje</h1>

        {/* Wie wint de quiz? */}
        <section className="w-full max-w-md rounded-xl border bg-card p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Wie wint de quiz?</h2>
            </div>
            <MarketStatusBadge settled={settled} open={marketOpen} />
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            Bet on who finishes on top. Odds update after every round; your
            payout is locked in at the odds shown when you bet. Paid out at the
            end of the quiz.
          </p>

          {/* Admin release control */}
          {admin && !settled && (
            <Button
              variant={marketOpen ? "outline" : "default"}
              onClick={handleToggleMarket}
              className="mb-3 w-full gap-1.5"
            >
              {marketOpen ? (
                <>
                  <Lock className="h-4 w-4" />
                  Lock betting
                </>
              ) : (
                <>
                  <LockOpen className="h-4 w-4" />
                  Release for betting
                </>
              )}
            </Button>
          )}

          {players.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              No players to bet on yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {players.map((p) => {
                const isSelected = !admin && selected === p;
                return (
                  <li key={p}>
                    <button
                      type="button"
                      disabled={admin || settled || !marketOpen}
                      onClick={() => setSelection(p)}
                      className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "bg-card hover:bg-accent"
                      } ${admin || settled || !marketOpen ? "cursor-default" : ""}`}
                    >
                      <span className="font-medium">
                        {p}
                        {p === username && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </span>
                      <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-semibold tabular-nums">
                        {odds[p]?.toFixed(2)}×
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Bet form (players only) */}
          {!admin && players.length > 0 && (
            settled ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                <Lock className="h-4 w-4" />
                Betting is closed — this market has been settled.
              </div>
            ) : !marketOpen ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                <Lock className="h-4 w-4" />
                Betting isn&apos;t open yet — the quizmaster will release it.
              </div>
            ) : (
              <form onSubmit={handlePlaceBet} className="mt-4 flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    placeholder="Amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <Button type="submit" className="shrink-0">
                    Place bet
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {selected && amtNum > 0
                    ? `Bet ${amtNum} on ${selected} to win ${potential} coins (incl. stake).`
                    : "Pick a player and enter an amount."}
                </p>
                {error && <p className="text-xs text-red-500">{error}</p>}
              </form>
            )
          )}
        </section>

        {/* Player's bets on this market */}
        {!admin && myMarketBets.length > 0 && (
          <section className="w-full max-w-md">
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">
              Your bets
            </h3>
            <ul className="flex flex-col gap-1.5">
              {myMarketBets.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between rounded-lg border bg-card px-4 py-2.5 text-sm"
                >
                  <span>
                    <span className="font-medium">{b.selection}</span>{" "}
                    <span className="text-muted-foreground">
                      @ {b.odds.toFixed(2)}×
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-muted-foreground">
                      {b.amount}
                    </span>
                    <BetStatusBadge bet={b} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <BottomNav quizHref={admin ? "/admin" : "/quiz"} />
    </div>
  );
}

function MarketStatusBadge({
  settled,
  open,
}: {
  settled: boolean;
  open: boolean;
}) {
  if (settled) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Settled
      </span>
    );
  }
  if (open) {
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        Open
      </span>
    );
  }
  return (
    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
      Locked
    </span>
  );
}

function BetStatusBadge({ bet }: { bet: Bet }) {
  if (bet.status === "won") {
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        Won +{bet.payout}
      </span>
    );
  }
  if (bet.status === "lost") {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        Lost
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Open
    </span>
  );
}
