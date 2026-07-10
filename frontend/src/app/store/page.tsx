"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  Coins,
  Martini,
  Beer,
  Trophy,
  ChevronDown,
  ExternalLink,
  Check,
} from "lucide-react";
import BottomNav from "@/components/BottomNav";
import UsernameBadge from "@/components/UsernameBadge";
import ChallengeInfoButton from "@/components/ChallengeInfoButton";
import LiveQuestionBanner from "@/components/LiveQuestionBanner";
import { Button } from "@/components/ui/button";
import { useGameState } from "@/lib/useGameState";
import { ADMIN_USERNAMES } from "@/lib/quizState";
import {
  COIN_PACK_COINS,
  COIN_PACK_PRICE_EUR,
  STORE_SHOT_PRICE,
  STORE_SIP_PRICE,
  TIKKIE_COINS_URL,
  TIKKIE_PUBQUIZ_URL,
  requestCoinPurchase,
  giveDrink,
  ackGift,
  releaseName,
  type GameState,
  type GiftKind,
} from "@/lib/api";

// Quizmasters can be handed a drink too; shown with their display casing.
const ADMIN_DISPLAY = ADMIN_USERNAMES.map((n) => n[0].toUpperCase() + n.slice(1));

export default function StorePage() {
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
  const gifts = state.you.gifts_received ?? [];
  const live = !admin && state.current_index >= 0 && state.entry_state === "open";

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-2">
          <UsernameBadge username={username} />
          {admin ? (
            <span className="text-sm font-medium text-muted-foreground">Winkel</span>
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
        <h1 className="text-2xl font-semibold">Store</h1>

        {/* Drinks handed to me */}
        {gifts.length > 0 && (
          <section className="w-full max-w-md space-y-2">
            {gifts.map((g) => (
              <GiftCard key={g.id} gift={g} setState={setState} />
            ))}
          </section>
        )}

        {/* Coins met echt geld (Tikkie) */}
        <CoinPackItem state={state} setState={setState} admin={admin} />

        {/* Grap-item: doet niks */}
        <PubquizWinItem admin={admin} />

        {/* Drankjes uitdelen met coins */}
        <DrinkItem
          kind="shot"
          price={STORE_SHOT_PRICE}
          title="Shotje uitdelen"
          icon={<Martini className="h-5 w-5 text-primary" strokeWidth={1.5} />}
          state={state}
          setState={setState}
          admin={admin}
          budget={budget}
          username={username}
        />
        <DrinkItem
          kind="sip"
          price={STORE_SIP_PRICE}
          title="Slok uitdelen"
          icon={<Beer className="h-5 w-5 text-primary" strokeWidth={1.5} />}
          state={state}
          setState={setState}
          admin={admin}
          budget={budget}
          username={username}
        />
      </main>

      <BottomNav
        quizHref={admin ? "/admin" : "/quiz"}
        giftsCount={gifts.length}
        isAdmin={admin}
        activityCount={(state.pending_purchases?.length ?? 0) + (state.pending_slot_drinks?.length ?? 0)}
      />
    </div>
  );
}

// --- Incoming drink notification --------------------------------------------

function GiftCard({
  gift,
  setState,
}: {
  gift: { id: number; kind: GiftKind; from: string };
  setState: (s: GameState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const Icon = gift.kind === "shot" ? Martini : Beer;
  const noun = gift.kind === "shot" ? "shotje" : "slokje";

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    try {
      setState(await ackGift(gift.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <Icon className="h-6 w-6 shrink-0 text-amber-700" strokeWidth={1.5} />
      <p className="flex-1 text-sm text-amber-900">
        <span className="font-semibold">{gift.from}</span> deelt je een {noun} uit!
      </p>
      <Button size="sm" variant="outline" onClick={dismiss} disabled={busy} className="gap-1">
        <Check className="h-4 w-4" />
        Oké
      </Button>
    </div>
  );
}

// --- Coin pack (real money via Tikkie) --------------------------------------

function CoinPackItem({
  state,
  setState,
  admin,
}: {
  state: GameState;
  setState: (s: GameState) => void;
  admin: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = state.you.pending_purchase;

  async function handleBuy() {
    if (busy) return;
    setError(null);
    // Open the Tikkie link, then file the purchase for the quizmaster to confirm.
    window.open(TIKKIE_COINS_URL, "_blank", "noopener,noreferrer");
    setBusy(true);
    try {
      setState(await requestCoinPurchase());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kon de aankoop niet plaatsen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StoreItem
      icon={<Coins className="h-5 w-5 text-primary" />}
      title={`${COIN_PACK_COINS} coins`}
      price={`${COIN_PACK_PRICE_EUR} euro`}
      defaultOpen
    >
      {admin ? null : pending ? (
        <div className="space-y-2">
          <div className="rounded-lg bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
            In afwachting van bevestiging…
          </div>
          <a
            href={TIKKIE_COINS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            Tikkie opnieuw openen
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          <Button onClick={handleBuy} disabled={busy} className="w-full gap-1.5">
            <ExternalLink className="h-4 w-4" />
            Betaal {COIN_PACK_PRICE_EUR} euro met Tikkie
          </Button>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </StoreItem>
  );
}

// --- Automatische pubquiz winst (grap) --------------------------------------

function PubquizWinItem({ admin }: { admin: boolean }) {
  const [clicked, setClicked] = useState(false);

  return (
    <StoreItem
      icon={<Trophy className="h-5 w-5 text-primary" />}
      title="Automatische pubquiz winst"
      price="1000 euro"
    >
      {admin ? null : (
        <div className="space-y-2">
          <a
            href={TIKKIE_PUBQUIZ_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setClicked(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <ExternalLink className="h-4 w-4" />
            Betaal 1000 euro met Tikkie
          </a>
          {clicked && <p className="text-center text-sm font-medium">Veel plezier ;)</p>}
        </div>
      )}
    </StoreItem>
  );
}

// --- Drink uitdelen (coins) -------------------------------------------------

function DrinkItem({
  kind,
  price,
  title,
  icon,
  state,
  setState,
  admin,
  budget,
  username,
}: {
  kind: GiftKind;
  price: number;
  title: string;
  icon: React.ReactNode;
  state: GameState;
  setState: (s: GameState) => void;
  admin: boolean;
  budget: number;
  username: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [given, setGiven] = useState<string | null>(null);

  const noun = kind === "shot" ? "shotje" : "slokje";
  const canAfford = budget >= price;

  // Any other contestant — active players plus the quizmasters — can receive it.
  const recipients = [...state.roster, ...ADMIN_DISPLAY].filter((n) => n !== username);

  async function give(recipient: string) {
    if (busy) return;
    setError(null);
    setGiven(null);
    setBusy(true);
    try {
      setState(await giveDrink(kind, recipient));
      setGiven(recipient);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kon niet uitdelen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StoreItem icon={icon} title={title} price={`${price} coins`}>
      {admin ? null : (
        <>
          <ul className="flex flex-col gap-1.5">
            {recipients.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  disabled={busy || !canAfford}
                  onClick={() => give(name)}
                  className="flex w-full items-center justify-between rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="font-medium">{name}</span>
                  <span className="text-sm text-muted-foreground">uitdelen</span>
                </button>
              </li>
            ))}
          </ul>
          {given && (
            <p className="mt-2 text-sm font-medium text-green-700">
              {given} krijgt een {noun}!
            </p>
          )}
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </>
      )}
    </StoreItem>
  );
}

// --- Collapsible store item (mirrors betje's MarketShell) -------------------

function StoreItem({
  icon,
  title,
  price,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  price: string;
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
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-sm font-semibold tabular-nums">
            {price}
          </span>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
              collapsed ? "" : "rotate-180"
            }`}
          />
        </div>
      </button>
      {!collapsed && <div className="px-4 pb-5">{children}</div>}
    </section>
  );
}
