"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  Coins,
  Gem,
  Martini,
  Beer,
  Cherry,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import BottomNav from "@/components/BottomNav";
import UsernameBadge from "@/components/UsernameBadge";
import LiveQuestionBanner from "@/components/LiveQuestionBanner";
import { Button } from "@/components/ui/button";
import { useGameState } from "@/lib/useGameState";
import {
  SLOT_COSTS,
  spinSlot,
  releaseName,
  type SlotSymbol,
  type SlotResult,
} from "@/lib/api";

// A spin only wins when all three reels land on the same symbol; the matched
// symbol decides the reward. Minimal line icons, one per symbol.
const SYMBOLS: Record<SlotSymbol, { Icon: LucideIcon; label: string; reward: string }> = {
  coin2x: { Icon: Coins, label: "2×", reward: "2× je inzet" },
  coin3x: { Icon: Gem, label: "3×", reward: "3× je inzet" },
  shot: { Icon: Martini, label: "Shot", reward: "Neem een shotje" },
  sip: { Icon: Beer, label: "Slok", reward: "Neem een slok" },
};
const ALL_SYMBOLS = Object.keys(SYMBOLS) as SlotSymbol[];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomSymbol = () => ALL_SYMBOLS[Math.floor(Math.random() * ALL_SYMBOLS.length)];

export default function MinigamesPage() {
  const router = useRouter();
  const { state, setState } = useGameState();

  const [cost, setCost] = useState<number>(SLOT_COSTS[0]);
  const [display, setDisplay] = useState<SlotSymbol[]>(["coin2x", "shot", "sip"]);
  const [reelSpinning, setReelSpinning] = useState<boolean[]>([false, false, false]);
  const [result, setResult] = useState<SlotResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // While a spin animates we show the stake as already deducted and hold any
  // winnings back until the reels land, so the poll can't spoil the result.
  const [budgetOverride, setBudgetOverride] = useState<number | null>(null);

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

  function handleLogout() {
    releaseName().finally(() => {
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("username");
      router.push("/login");
    });
  }

  async function handleSpin() {
    if (busy || !state) return;
    const before = state.you.budget ?? 0;
    setError(null);
    setResult(null);
    setBusy(true);
    setBudgetOverride(before - cost); // stake gone immediately, winnings withheld
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

  if (!state) return null;

  const username = state.you.username;
  const admin = state.you.is_admin;
  const budget = budgetOverride ?? state.you.budget ?? 0;
  const live = !admin && state.current_index >= 0 && state.entry_state === "open";

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
        <h1 className="text-2xl font-semibold">Minigames</h1>

        <GameShell
          icon={<Cherry className="h-5 w-5 text-primary" />}
          title="Slot"
          subtitle="Drie gelijk wint"
          defaultOpen
        >
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
            ) : (
              <div className="flex w-full max-w-xs flex-col items-center gap-5">
                {/* Cost selector — plain text */}
                <div className="flex items-center gap-6 text-sm">
                  {SLOT_COSTS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={busy || budget < c}
                      onClick={() => setCost(c)}
                      className={`tabular-nums transition-colors disabled:opacity-30 ${
                        cost === c
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>

                <Button
                  onClick={handleSpin}
                  disabled={busy || budget < cost}
                  className="w-full"
                  size="lg"
                >
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
        </GameShell>

        {/* Room for more minigames */}
        <div className="flex w-full max-w-md items-center justify-center rounded-xl border border-dashed bg-card/40 px-4 py-6 text-sm text-muted-foreground">
          Meer minigames volgen…
        </div>
      </main>

      <BottomNav quizHref={admin ? "/admin" : "/quiz"} />
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
