"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  Coins,
  Gem,
  Martini,
  Beer,
  Crown,
  Cherry,
  Rocket,
  Disc3,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import BottomNav from "@/components/BottomNav";
import UsernameBadge from "@/components/UsernameBadge";
import ChallengeInfoButton from "@/components/ChallengeInfoButton";
import LiveQuestionBanner from "@/components/LiveQuestionBanner";
import { Button } from "@/components/ui/button";
import { useGameState } from "@/lib/useGameState";
import {
  MINIGAME_COSTS,
  SLOT_COSTS,
  spinSlot,
  startCrash,
  cashoutCrash,
  playRoulette,
  releaseName,
  type GameState,
  type SlotSymbol,
  type SlotResult,
  type SlotLock,
  type CrashStart,
  type CrashResult,
  type CrashRoundState,
  type RouletteResult,
  type RouletteBet,
  type RouletteColor,
} from "@/lib/api";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared props every game box needs: the effective budget (for disabling
// stakes), the real budget to deduct from, and the two hooks used to hold the
// displayed budget steady while a result animates in (see budgetOverride).
interface GameProps {
  admin: boolean;
  budget: number;
  realBudget: number;
  setBudgetOverride: (n: number | null) => void;
  setState: (s: GameState) => void;
}

export default function MinigamesPage() {
  const router = useRouter();
  const { state, setState } = useGameState();

  // While any game animates a result we show its stake as already deducted and
  // hold winnings back until the reveal, so the 1s poll can't spoil the outcome.
  const [budgetOverride, setBudgetOverride] = useState<number | null>(null);

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
  const realBudget = state.you.budget ?? 0;
  const budget = budgetOverride ?? realBudget;
  const live = !admin && state.current_index >= 0 && state.entry_state === "open";

  const gameProps: GameProps = {
    admin,
    budget,
    realBudget,
    setBudgetOverride,
    setState,
  };

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-2">
          <UsernameBadge username={username} />
          {admin ? (
            <span className="text-sm font-medium text-muted-foreground">Speelhal</span>
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-800">
              <Coins className="h-4 w-4" />
              {budget} coins
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!admin && <ChallengeInfoButton username={username} />}
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

      <main className="flex flex-1 flex-col items-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">Minigames</h1>

        <GameShell
          icon={<Cherry className="h-5 w-5 text-primary" />}
          title="Slot"
          subtitle="Drie gelijk wint"
          defaultOpen
        >
          <SlotGame {...gameProps} slotLock={state.you.slot_lock} />
        </GameShell>

        <GameShell
          icon={<Rocket className="h-5 w-5 text-primary" />}
          title="Crash"
          subtitle="Cash uit voor de crash"
        >
          <CrashGame {...gameProps} crashRound={state.you.crash_round} />
        </GameShell>

        <GameShell
          icon={<Disc3 className="h-5 w-5 text-primary" />}
          title="Roulette"
          subtitle="Zet in op het wiel"
        >
          <RouletteGame {...gameProps} />
        </GameShell>
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

// --- Slot -------------------------------------------------------------------

// A spin only wins when all three reels land on the same symbol; the matched
// symbol decides the reward. Minimal line icons, one per symbol.
const SYMBOLS: Record<SlotSymbol, { Icon: LucideIcon; label: string; reward: string }> = {
  coin2x: { Icon: Coins, label: "2×", reward: "2× je inzet" },
  coin3x: { Icon: Gem, label: "3×", reward: "3× je inzet" },
  shot: { Icon: Martini, label: "Shot", reward: "Neem een shotje" },
  sip: { Icon: Beer, label: "Slok", reward: "Neem een slok" },
  jackpot: { Icon: Crown, label: "Jackpot", reward: "JACKPOT! 800 coins" },
};
const ALL_SYMBOLS = Object.keys(SYMBOLS) as SlotSymbol[];
const randomSymbol = () => ALL_SYMBOLS[Math.floor(Math.random() * ALL_SYMBOLS.length)];

function SlotGame({
  admin,
  budget,
  realBudget,
  setBudgetOverride,
  setState,
  slotLock,
}: GameProps & { slotLock: SlotLock | null }) {
  const [cost, setCost] = useState<number>(SLOT_COSTS[0]);
  // A drink landed on an earlier spin locks the machine until a quizmaster
  // confirms it on the Activity page.
  const locked = slotLock !== null;
  const lockLabel = slotLock?.kind === "shot" ? "shotje" : "slokje";
  const [display, setDisplay] = useState<SlotSymbol[]>(["coin2x", "shot", "sip"]);
  const [reelSpinning, setReelSpinning] = useState<boolean[]>([false, false, false]);
  const [result, setResult] = useState<SlotResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Values a reel has locked onto; while null the tick shows a random symbol.
  const lockedRef = useRef<(SlotSymbol | null)[]>([null, null, null]);
  const intervalRef = useRef<number | null>(null);

  function stopTicker() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  // Stop the spin animation if we navigate away mid-spin.
  useEffect(() => stopTicker, []);

  async function handleSpin() {
    if (busy || admin || locked) return;
    setError(null);
    setResult(null);
    setBusy(true);
    setBudgetOverride(realBudget - cost); // stake gone immediately, winnings withheld
    lockedRef.current = [null, null, null];
    setReelSpinning([true, true, true]);

    // Blur the reels through a quick cycle of random symbols until they lock.
    stopTicker();
    intervalRef.current = window.setInterval(() => {
      setDisplay((prev) => prev.map((s, i) => lockedRef.current[i] ?? randomSymbol()));
    }, 80);

    const start = Date.now();
    try {
      const next = await spinSlot(cost);
      const spin = next.spin;
      if (!spin) throw new Error("Geen resultaat ontvangen.");

      // Let the reels blur for a moment, then lock them one by one, left to right.
      await delay(Math.max(0, 700 - (Date.now() - start)));
      for (let i = 0; i < 3; i++) {
        lockedRef.current[i] = spin.reels[i];
        setDisplay((prev) => prev.map((s, j) => lockedRef.current[j] ?? s));
        setReelSpinning((prev) => prev.map((v, j) => (j === i ? false : v)));
        await delay(i < 2 ? 450 : 300);
      }

      stopTicker();
      setDisplay(spin.reels);
      setResult(spin);
      // Reels have landed — now release the real budget (with any winnings).
      setState(next);
      setBudgetOverride(null);
    } catch (e) {
      stopTicker();
      setReelSpinning([false, false, false]);
      setBudgetOverride(null);
      setError(e instanceof Error ? e.message : "Kon niet spelen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 pt-1">
      {/* Reels */}
      <div className="flex items-center justify-center gap-10">
        {display.map((sym, i) => {
          const Icon = SYMBOLS[sym].Icon;
          return (
            <Icon
              key={i}
              strokeWidth={1.5}
              className={`h-12 w-12 transition-opacity ${
                reelSpinning[i] ? "text-muted-foreground/40" : "text-foreground"
              }`}
            />
          );
        })}
      </div>

      {/* Result — one quiet line */}
      <div className="min-h-[1.25rem] text-sm">
        {error ? (
          <span className="text-red-500">{error}</span>
        ) : result ? (
          result.win ? (
            <span className="font-medium">
              {result.coins_won > 0
                ? `+${result.coins_won} coins`
                : result.symbol && SYMBOLS[result.symbol].reward}
            </span>
          ) : (
            <span className="text-muted-foreground">Geen match</span>
          )
        ) : (
          <span className="text-muted-foreground">Kies je inzet en spin</span>
        )}
      </div>

      {admin ? (
        <p className="text-sm text-muted-foreground">Beheerders kunnen niet spelen.</p>
      ) : locked && !busy ? (
        // Hold the lock banner back until the reels have finished landing: the
        // 1s poll can set slot_lock mid-spin, but `busy` stays true until the
        // animation ends, so the drink message only shows once the roll is done.
        <div className="flex w-full max-w-xs flex-col items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-rose-100 px-4 py-3 text-center text-sm font-medium text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
            {slotLock?.kind === "shot" ? (
              <Martini className="h-5 w-5 shrink-0" />
            ) : (
              <Beer className="h-5 w-5 shrink-0" />
            )}
            Doe je {lockLabel}! De gokkast is op slot tot de beheerder het bevestigt.
          </div>
        </div>
      ) : (
        <div className="flex w-full max-w-xs flex-col items-center gap-5">
          <StakeSelector value={cost} onChange={setCost} budget={budget} disabled={busy} />
          <Button onClick={handleSpin} disabled={busy || budget < cost} className="w-full" size="lg">
            {busy ? "Draaien…" : "Spin"}
          </Button>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {ALL_SYMBOLS.map((sym) => {
          const Icon = SYMBOLS[sym].Icon;
          return (
            <span key={sym} className="flex items-center gap-1.5">
              <Icon className="h-4 w-4" strokeWidth={1.5} />
              {SYMBOLS[sym].label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// --- Crash ------------------------------------------------------------------

// The multiplier curve must match the server: 1.00× at the start, doubling
// every 1.5s.
const CRASH_HALF_LIFE = 1.5;
const crashMultiplier = (elapsedSeconds: number) =>
  elapsedSeconds <= 0 ? 1 : Math.pow(2, elapsedSeconds / CRASH_HALF_LIFE);

// idle → running (climbing) → the player may cash out (→ cashed, still climbing)
// → crashed (frozen at the crash point). Everyone watches the climb reach the
// crash whether or not they banked their coins first.
type CrashPhase = "idle" | "running" | "cashed" | "crashed";

function CrashGame({
  admin,
  budget,
  setState,
  crashRound,
}: GameProps & { crashRound: CrashRoundState | null }) {
  const [cost, setCost] = useState<number>(MINIGAME_COSTS[0]);
  const [multiplier, setMultiplier] = useState(1);
  const [phase, setPhase] = useState<CrashPhase>("idle");
  // The winning cash-out, kept on screen while the round keeps climbing.
  const [cashResult, setCashResult] = useState<CrashResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<number | null>(null);
  // The local wall-clock time (ms) the round is treated as having started.
  const startedRef = useRef<number>(0);
  // Where this round crashes — known to the client so it can animate the crash.
  const crashPointRef = useRef<number>(0);
  // Guards the one server settlement (a bust) so the ticker fires it only once.
  const settlingRef = useRef(false);
  // Latest phase/busy for callbacks that outlive a render (the ticker, resume).
  const phaseRef = useRef<CrashPhase>("idle");
  phaseRef.current = phase;
  const busyRef = useRef(false);
  busyRef.current = busy;

  function stopTicker() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }
  useEffect(() => stopTicker, []);

  function startTicker() {
    stopTicker();
    intervalRef.current = window.setInterval(() => {
      const m = crashMultiplier((Date.now() - startedRef.current) / 1000);
      if (m >= crashPointRef.current) {
        setMultiplier(crashPointRef.current);
        stopTicker();
        void reachCrash();
        return;
      }
      setMultiplier(m);
    }, 60);
  }

  // The climb has reached the crash point. If the player never cashed out this
  // is a bust — close the round server-side (the stake was charged at start).
  async function reachCrash() {
    setPhase("crashed");
    if (phaseRef.current === "running" && !settlingRef.current) {
      settlingRef.current = true;
      try {
        setState(await cashoutCrash()); // server settles it as a bust
      } catch {
        /* leave it — the next round start forfeits any stale round */
      }
    }
  }

  async function handleStart() {
    if (busy || admin || phase === "running") return;
    setError(null);
    setCashResult(null);
    setBusy(true);
    try {
      const next = await startCrash(cost); // stake charged server-side
      setState(next);
      crashPointRef.current = (next.crash as CrashStart).crash_point;
      settlingRef.current = false;
      startedRef.current = Date.now();
      setMultiplier(1);
      setPhase("running");
      startTicker();
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Kon niet starten.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCashout() {
    if (busyRef.current || phaseRef.current !== "running" || settlingRef.current) return;
    settlingRef.current = true;
    setBusy(true);
    try {
      const next = await cashoutCrash();
      const crash = next.crash as CrashResult;
      setState(next);
      if (crash.win) {
        setCashResult(crash);
        setPhase("cashed"); // banked — but keep climbing to show the crash
      } else {
        // Edge case: the server clock says it already crashed. Show that.
        setMultiplier(crash.crash_point);
        setPhase("crashed");
        stopTicker();
      }
    } catch (e) {
      settlingRef.current = false;
      setError(e instanceof Error ? e.message : "Kon niet cashen.");
    } finally {
      setBusy(false);
    }
  }

  // Resume a round left running (e.g. after reopening the tab). An active round
  // means it wasn't cashed out. Uses the server-measured elapsed time so no
  // client clock sync is needed.
  useEffect(() => {
    if (phase !== "idle" || busy || !crashRound) return;
    setCost(crashRound.cost);
    setCashResult(null);
    crashPointRef.current = crashRound.crash_point;
    settlingRef.current = false;
    startedRef.current = Date.now() - crashRound.elapsed_ms;
    setMultiplier(crashMultiplier(crashRound.elapsed_ms / 1000));
    setPhase("running");
    startTicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crashRound, phase, busy]);

  const running = phase === "running";
  const multColor =
    phase === "crashed"
      ? "text-red-500"
      : phase === "cashed"
        ? "text-green-600"
        : "text-foreground";

  return (
    <div className="flex flex-col items-center gap-6 pt-1">
      {/* Multiplier — climbs live, then freezes red at the crash */}
      <div className={`text-4xl font-bold tabular-nums transition-colors ${multColor}`}>
        {multiplier.toFixed(2)}×
      </div>

      {/* Result / hint */}
      <div className="flex min-h-[1.25rem] flex-col items-center gap-0.5 text-sm">
        {error ? (
          <span className="text-red-500">{error}</span>
        ) : running ? (
          <span className="text-muted-foreground">Tik om te cashen…</span>
        ) : phase === "cashed" ? (
          <span className="font-medium text-green-600">
            Gecasht bij {cashResult?.multiplier}× · +{cashResult?.coins_won} coins
          </span>
        ) : phase === "crashed" ? (
          <>
            {cashResult && (
              <span className="font-medium text-green-600">
                Gecasht bij {cashResult.multiplier}× · +{cashResult.coins_won} coins
              </span>
            )}
            <span className="text-red-500">
              Gecrasht bij {multiplier.toFixed(2)}×{cashResult ? "" : " · inzet kwijt"}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Kies je inzet en start</span>
        )}
      </div>

      {admin ? (
        <p className="text-sm text-muted-foreground">Beheerders kunnen niet spelen.</p>
      ) : running ? (
        <Button
          onClick={handleCashout}
          disabled={busy}
          className="w-full max-w-xs bg-green-600 hover:bg-green-700"
          size="lg"
        >
          Cash Out
        </Button>
      ) : phase === "cashed" ? (
        <p className="text-sm text-muted-foreground">Wachten op de crash…</p>
      ) : (
        <div className="flex w-full max-w-xs flex-col items-center gap-5">
          <StakeSelector value={cost} onChange={setCost} budget={budget} disabled={busy} />
          <Button onClick={handleStart} disabled={busy || budget < cost} className="w-full" size="lg">
            {busy ? "Bezig…" : "Start"}
          </Button>
        </div>
      )}
    </div>
  );
}

// --- Roulette ---------------------------------------------------------------

// Red pockets on a European wheel — used to colour the ticking numbers.
const ROULETTE_RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);
function numberColor(n: number): RouletteColor {
  return n === 0 ? "green" : ROULETTE_RED.has(n) ? "red" : "black";
}
const COLOR_NL: Record<RouletteColor, string> = { red: "rood", black: "zwart", green: "groen" };
const CHIP_CLASS: Record<RouletteColor, string> = {
  red: "bg-red-600 text-white",
  black: "bg-neutral-800 text-white",
  green: "bg-green-600 text-white",
};

const ROULETTE_BETS: { key: RouletteBet; label: string; payout: string }[] = [
  { key: "red", label: "Rood", payout: "2×" },
  { key: "black", label: "Zwart", payout: "2×" },
  { key: "even", label: "Even", payout: "2×" },
  { key: "odd", label: "Oneven", payout: "2×" },
  { key: "low", label: "1–18", payout: "2×" },
  { key: "high", label: "19–36", payout: "2×" },
  { key: "green", label: "0 (groen)", payout: "36×" },
];

function RouletteGame({ admin, budget, realBudget, setBudgetOverride, setState }: GameProps) {
  const [cost, setCost] = useState<number>(MINIGAME_COSTS[0]);
  const [bet, setBet] = useState<RouletteBet>("red");
  const [displayNum, setDisplayNum] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<RouletteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<number | null>(null);
  function stopTicker() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }
  useEffect(() => stopTicker, []);

  async function handleSpin() {
    if (busy || admin) return;
    setError(null);
    setResult(null);
    setBusy(true);
    setSpinning(true);
    setBudgetOverride(realBudget - cost); // stake gone immediately

    // Flick through random pockets while we wait on the server.
    stopTicker();
    intervalRef.current = window.setInterval(() => {
      setDisplayNum(Math.floor(Math.random() * 37));
    }, 70);

    const start = Date.now();
    try {
      const next = await playRoulette(cost, bet);
      const roulette = next.roulette;
      if (!roulette) throw new Error("Geen resultaat ontvangen.");

      await delay(Math.max(0, 1100 - (Date.now() - start)));
      stopTicker();
      setDisplayNum(roulette.number);
      setSpinning(false);
      setResult(roulette);
      setState(next);
      setBudgetOverride(null);
    } catch (e) {
      stopTicker();
      setSpinning(false);
      setBudgetOverride(null);
      setError(e instanceof Error ? e.message : "Kon niet spelen.");
    } finally {
      setBusy(false);
    }
  }

  const chipColor = spinning ? numberColor(displayNum) : result ? result.color : numberColor(displayNum);

  return (
    <div className="flex flex-col items-center gap-6 pt-1">
      {/* Landed number */}
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold tabular-nums transition-colors ${CHIP_CLASS[chipColor]}`}
      >
        {displayNum}
      </div>

      {/* Result — one quiet line */}
      <div className="min-h-[1.25rem] text-sm">
        {error ? (
          <span className="text-red-500">{error}</span>
        ) : result ? (
          result.win ? (
            <span className="font-medium text-green-600">+{result.coins_won} coins</span>
          ) : (
            <span className="text-muted-foreground">
              {result.number} {COLOR_NL[result.color]} — niks
            </span>
          )
        ) : (
          <span className="text-muted-foreground">Kies je inzet en draai</span>
        )}
      </div>

      {admin ? (
        <p className="text-sm text-muted-foreground">Beheerders kunnen niet spelen.</p>
      ) : (
        <div className="flex w-full max-w-xs flex-col items-center gap-5">
          <StakeSelector value={cost} onChange={setCost} budget={budget} disabled={busy} />

          {/* Bet selector */}
          <div className="flex flex-wrap justify-center gap-2">
            {ROULETTE_BETS.map((b) => (
              <button
                key={b.key}
                type="button"
                disabled={busy}
                onClick={() => setBet(b.key)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-30 ${
                  bet === b.key
                    ? "border-primary bg-primary/10 font-semibold text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {b.label} <span className="text-xs text-muted-foreground">{b.payout}</span>
              </button>
            ))}
          </div>

          <Button onClick={handleSpin} disabled={busy || budget < cost} className="w-full" size="lg">
            {busy ? "Draaien…" : "Draai"}
          </Button>
        </div>
      )}
    </div>
  );
}

// --- Shared stake selector --------------------------------------------------

function StakeSelector({
  value,
  onChange,
  budget,
  disabled,
}: {
  value: number;
  onChange: (c: number) => void;
  budget: number;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-6 text-sm">
      {MINIGAME_COSTS.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled || budget < c}
          onClick={() => onChange(c)}
          className={`tabular-nums transition-colors disabled:opacity-30 ${
            value === c
              ? "font-semibold text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

// --- Collapsible game box (mirrors betje's MarketShell) ---------------------

function GameShell({
  icon,
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(!defaultOpen);
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
          <div>
            <h2 className="text-lg font-semibold leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
            collapsed ? "" : "rotate-180"
          }`}
        />
      </button>
      {!collapsed && <div className="px-4 pb-5">{children}</div>}
    </section>
  );
}
