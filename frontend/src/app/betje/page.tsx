"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  Coins,
  Trophy,
  TrendingDown,
  Target,
  Lock,
  LockOpen,
  Check,
  CheckCircle,
  XCircle,
  ChevronDown,
} from "lucide-react";
import BottomNav from "@/components/BottomNav";
import UsernameBadge from "@/components/UsernameBadge";
import LiveQuestionBanner from "@/components/LiveQuestionBanner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useGameState } from "@/lib/useGameState";
import {
  QUIZ_WINNER_MARKET,
  QUIZ_LOSER_MARKET,
  CHALLENGE_MARKET,
  adminMarket,
  placeBet,
  placeChallengeBet,
  releaseName,
  type Bet,
  type GameState,
  type Market,
} from "@/lib/api";

export default function BetjePage() {
  const router = useRouter();
  const { state, setState } = useGameState();

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
  const budget = state.you.budget ?? 0;
  const live = !admin && state.current_index >= 0 && state.entry_state === "open";

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-2">
          <UsernameBadge username={username} />
          {admin ? (
            <span className="text-sm font-medium text-muted-foreground">Oddsbord</span>
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-800">
              <Coins className="h-4 w-4" />
              {budget} coins
            </div>
          )}
        </div>
        <button
          onClick={handleLogout}
          aria-label="Uitloggen"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
        >
          <LogOut className="h-6 w-6" />
        </button>
      </header>

      <LiveQuestionBanner live={live} />

      <main className="flex flex-1 flex-col items-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">Betje</h1>

        <OutcomeMarket
          marketKey={QUIZ_WINNER_MARKET}
          title="Wie wint de quiz?"
          icon={<Trophy className="h-5 w-5 text-primary" />}
          verb="wint"
          state={state}
          setState={setState}
          admin={admin}
          username={username}
        />

        <OutcomeMarket
          marketKey={QUIZ_LOSER_MARKET}
          title="Wie wordt laatste?"
          icon={<TrendingDown className="h-5 w-5 text-primary" />}
          verb="laatste wordt"
          state={state}
          setState={setState}
          admin={admin}
          username={username}
        />

        <ChallengeMarket
          state={state}
          setState={setState}
          admin={admin}
          username={username}
        />
      </main>

      <BottomNav
        quizHref={admin ? "/admin" : "/quiz"}
        giftsCount={state.you.gifts_received?.length ?? 0}
        isAdmin={admin}
        activityCount={state.pending_purchases?.length ?? 0}
      />
    </div>
  );
}

// --- Collapsible market shell -----------------------------------------------

function MarketShell({
  icon,
  title,
  settled,
  open,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  settled: boolean;
  open: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <section className="w-full max-w-md rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <MarketStatusBadge settled={settled} open={open} />
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
              collapsed ? "" : "rotate-180"
            }`}
          />
        </div>
      </button>
      {!collapsed && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

// --- Single-pick outcome market (winner / loser) ----------------------------

interface OutcomeMarketProps {
  marketKey: string;
  title: string;
  icon: React.ReactNode;
  verb: string;
  state: GameState;
  setState: (s: GameState) => void;
  admin: boolean;
  username: string;
}

function OutcomeMarket({
  marketKey,
  title,
  icon,
  verb,
  state,
  setState,
  admin,
  username,
}: OutcomeMarketProps) {
  const [selection, setSelection] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const players = state.roster;
  const market: Market | undefined = state.markets.find((m) => m.key === marketKey);
  const odds = market?.odds ?? {};
  const marketOpen = market?.is_open ?? false;
  const settled = market?.is_settled ?? false;

  const selected = selection || players[0] || "";
  const amtNum = Math.floor(Number(amount));
  const potential =
    selected && odds[selected] && amtNum > 0 ? Math.round(amtNum * odds[selected]) : 0;
  const myMarketBets = state.you.my_bets.filter((b) => b.market === marketKey);

  async function toggleMarket(open: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      setState(await adminMarket(marketKey, open));
    } finally {
      setBusy(false);
    }
  }

  async function handlePlaceBet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selected) {
      setError("Nog geen spelers om op te wedden.");
      return;
    }
    if (!Number.isFinite(amtNum) || amtNum <= 0) {
      setError("Voer een bedrag groter dan 0 in.");
      return;
    }
    setBusy(true);
    try {
      setState(await placeBet(marketKey, selected, amtNum));
      setAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kon de inzet niet plaatsen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <MarketShell icon={icon} title={title} settled={settled} open={marketOpen}>
      {admin && !settled && (
        <MarketToggle open={marketOpen} busy={busy} onToggle={() => toggleMarket(!marketOpen)} />
      )}

      {players.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">Nog geen spelers om op te wedden.</p>
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
                    isSelected ? "border-primary bg-primary/5" : "bg-card hover:bg-accent"
                  } ${admin || settled || !marketOpen ? "cursor-default" : ""}`}
                >
                  <span className="font-medium">
                    {p}
                    {p === username && (
                      <span className="ml-1.5 text-xs text-muted-foreground">(jij)</span>
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

      {!admin &&
        players.length > 0 &&
        (settled ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" />
            Wedden is gesloten — deze markt is afgerekend.
          </div>
        ) : marketOpen ? (
          <form onSubmit={handlePlaceBet} className="mt-4 flex flex-col gap-2">
            <div className="flex gap-2">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="Bedrag"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Button type="submit" className="shrink-0" disabled={busy}>
                Zet in
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {selected && amtNum > 0
                ? `Zet ${amtNum} in dat ${selected} ${verb} voor ${potential} coins (incl. inzet).`
                : "Kies een speler en voer een bedrag in."}
            </p>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </form>
        ) : null)}

      {!admin && myMarketBets.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Jouw inzetten</h3>
          <ul className="flex flex-col gap-1.5">
            {myMarketBets.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-lg border bg-card px-4 py-2.5 text-sm"
              >
                <span>
                  <span className="font-medium">{b.selection}</span>{" "}
                  <span className="text-muted-foreground">@ {b.odds.toFixed(2)}×</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-muted-foreground">{b.amount}</span>
                  <BetStatusBadge bet={b} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </MarketShell>
  );
}

// --- Challenge parlay market ------------------------------------------------

interface ChallengeMarketProps {
  state: GameState;
  setState: (s: GameState) => void;
  admin: boolean;
  username: string;
}

function ChallengeMarket({ state, setState, admin, username }: ChallengeMarketProps) {
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const players = state.roster;
  const statuses = state.challenge.statuses;
  const factor = state.challenge.factor;
  const market: Market | undefined = state.markets.find((m) => m.key === CHALLENGE_MARKET);
  const marketOpen = market?.is_open ?? false;
  const settled = market?.is_settled ?? false;

  const myBet = state.you.my_bets.find((b) => b.market === CHALLENGE_MARKET);
  const count = picks.size;
  const parlayOdds = count > 0 ? Math.round(factor ** count * 100) / 100 : 0;
  const amtNum = Math.floor(Number(amount));
  const potential = parlayOdds && amtNum > 0 ? Math.round(amtNum * parlayOdds) : 0;

  function togglePick(name: string) {
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function toggleMarket(open: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      setState(await adminMarket(CHALLENGE_MARKET, open));
    } finally {
      setBusy(false);
    }
  }

  async function handlePlaceBet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (picks.size === 0) {
      setError("Kies minstens één speler.");
      return;
    }
    if (!Number.isFinite(amtNum) || amtNum <= 0) {
      setError("Voer een bedrag groter dan 0 in.");
      return;
    }
    setBusy(true);
    try {
      setState(await placeChallengeBet([...picks], amtNum));
      setPicks(new Set());
      setAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kon de inzet niet plaatsen.");
    } finally {
      setBusy(false);
    }
  }

  // A player can be picked only if their challenge is still pending and it isn't
  // the bettor themselves.
  function pickable(name: string): boolean {
    return name !== username && (statuses[name] ?? "pending") === "pending";
  }

  const canBet = !admin && !settled && marketOpen && !myBet;

  return (
    <MarketShell
      icon={<Target className="h-5 w-5 text-primary" />}
      title="Wie haalt zijn challenge?"
      settled={settled}
      open={marketOpen}
    >
      <p className="mb-3 text-xs text-muted-foreground">
        Kies de spelers van wie jij denkt dat ze hun challenge halen. Hoe meer je kiest, hoe hoger
        de uitbetaling — maar als er zelfs één mislukt, verlies je alles. Eén inzet per persoon.
      </p>

      {admin && !settled && (
        <MarketToggle open={marketOpen} busy={busy} onToggle={() => toggleMarket(!marketOpen)} />
      )}

      {players.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">Nog geen spelers.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {players.map((p) => {
            const status = statuses[p] ?? "pending";
            const isSelf = p === username;
            const selectable = canBet && pickable(p);
            const checked = picks.has(p);
            return (
              <li key={p}>
                <button
                  type="button"
                  disabled={!selectable}
                  onClick={() => togglePick(p)}
                  className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                    checked ? "border-primary bg-primary/5" : "bg-card"
                  } ${selectable ? "hover:bg-accent" : "cursor-default opacity-70"}`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    {canBet && !isSelf && status === "pending" && (
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded border ${
                          checked ? "border-primary bg-primary text-primary-foreground" : "bg-card"
                        }`}
                      >
                        {checked && <Check className="h-3.5 w-3.5" />}
                      </span>
                    )}
                    {p}
                    {isSelf && (
                      <span className="text-xs text-muted-foreground">(jij)</span>
                    )}
                  </span>
                  <ChallengeStatusBadge status={status} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {myBet ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Jouw challenge-inzet</h3>
          <div className="rounded-lg border bg-card px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {myBet.selections.length} keuze{myBet.selections.length === 1 ? "" : "s"} @{" "}
                {myBet.odds.toFixed(2)}×
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums text-muted-foreground">{myBet.amount}</span>
                <BetStatusBadge bet={myBet} />
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {myBet.selections.map((name) => (
                <span
                  key={name}
                  className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium"
                >
                  {name}
                  <ChallengeStatusDot status={statuses[name] ?? "pending"} />
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        !admin &&
        players.length > 0 &&
        (settled ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" />
            Wedden is gesloten — deze markt is afgerekend.
          </div>
        ) : marketOpen ? (
          <form onSubmit={handlePlaceBet} className="mt-4 flex flex-col gap-2">
            <div className="flex gap-2">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="Bedrag"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Button type="submit" className="shrink-0" disabled={busy}>
                Zet in
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {count > 0 && amtNum > 0
                ? `${count} keuze${count === 1 ? "" : "s"} @ ${parlayOdds.toFixed(
                    2
                  )}× — zet ${amtNum} in om ${potential} coins te winnen (incl. inzet).`
                : "Vink de spelers aan die je steunt en voer een bedrag in."}
            </p>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </form>
        ) : null)
      )}
    </MarketShell>
  );
}

// --- Shared bits ------------------------------------------------------------

function MarketToggle({
  open,
  busy,
  onToggle,
}: {
  open: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant={open ? "outline" : "default"}
      onClick={onToggle}
      disabled={busy}
      className="mb-3 w-full gap-1.5"
    >
      {open ? (
        <>
          <Lock className="h-4 w-4" />
          Wedden sluiten
        </>
      ) : (
        <>
          <LockOpen className="h-4 w-4" />
          Openstellen voor wedden
        </>
      )}
    </Button>
  );
}

function MarketStatusBadge({ settled, open }: { settled: boolean; open: boolean }) {
  if (settled) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Afgerekend
      </span>
    );
  }
  if (open) {
    return <LockOpen className="h-4 w-4 text-green-600" aria-label="Wedden open" />;
  }
  return <Lock className="h-4 w-4 text-muted-foreground" aria-label="Wedden gesloten" />;
}

function BetStatusBadge({ bet }: { bet: Bet }) {
  if (bet.status === "won") {
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        Gewonnen +{bet.payout}
      </span>
    );
  }
  if (bet.status === "lost") {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        Verloren
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Open
    </span>
  );
}

function ChallengeStatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        <CheckCircle className="h-3.5 w-3.5" />
        Gehaald
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        <XCircle className="h-3.5 w-3.5" />
        Mislukt
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      In afwachting
    </span>
  );
}

function ChallengeStatusDot({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "bg-green-500"
      : status === "failed"
      ? "bg-red-500"
      : "bg-muted-foreground";
  return <span className={`h-1.5 w-1.5 rounded-full ${color}`} />;
}
