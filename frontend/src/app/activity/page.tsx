"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  CheckCircle,
  Coins,
  Gamepad2,
  Gift,
  LogOut,
  ShieldCheck,
  ShoppingBag,
  Target,
  XCircle,
} from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { useGameState } from "@/lib/useGameState";
import {
  adminConfirmPurchase,
  adminDeclareChallenge,
  releaseName,
  type ActivityEvent,
  type AdminPurchase,
  type ChallengeStatus,
  type GameState,
} from "@/lib/api";

export default function ActivityPage() {
  const router = useRouter();
  const { state, setState } = useGameState();
  const [busy, setBusy] = useState(false);

  // Non-admins don't belong here.
  useEffect(() => {
    if (state && !state.you.is_admin) router.replace("/quiz");
  }, [state, router]);

  async function run(action: () => Promise<GameState>) {
    if (busy) return;
    setBusy(true);
    try {
      setState(await action());
    } finally {
      setBusy(false);
    }
  }

  function handleLogout() {
    releaseName().finally(() => {
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("username");
      router.push("/login");
    });
  }

  if (!state || !state.you.is_admin) return null;

  return (
    <div className="flex min-h-screen flex-col bg-background pb-24">
      <header className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-1.5 px-2 text-sm font-medium text-primary">
          <ShieldCheck className="h-4 w-4" />
          <span className="max-w-[10rem] truncate">{state.you.username}</span>
        </div>
        <button
          onClick={handleLogout}
          aria-label="Uitloggen"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
        >
          <LogOut className="h-6 w-6" />
        </button>
      </header>

      <main className="flex flex-1 flex-col items-center gap-5 p-6">
        <h1 className="text-2xl font-semibold">Activiteit</h1>

        <PurchasesPanel
          purchases={state.pending_purchases}
          busy={busy}
          onConfirm={(id) => run(() => adminConfirmPurchase(id))}
        />

        <ChallengePanel
          roster={state.roster}
          statuses={state.challenge.statuses}
          busy={busy}
          onDeclare={(username, status) => run(() => adminDeclareChallenge(username, status))}
        />

        <ActivityFeed events={state.activity} />
      </main>

      <BottomNav
        quizHref="/admin"
        giftsCount={state.you.gifts_received?.length ?? 0}
        isAdmin
        activityCount={state.pending_purchases?.length ?? 0}
      />
    </div>
  );
}

// --- Buy requests -----------------------------------------------------------

function PurchasesPanel({
  purchases,
  busy,
  onConfirm,
}: {
  purchases: AdminPurchase[];
  busy: boolean;
  onConfirm: (id: number) => void;
}) {
  return (
    <div className="w-full max-w-md rounded-xl border bg-card">
      <div className="flex items-center gap-2 p-4 pb-2">
        <ShoppingBag className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Aankopen</h3>
      </div>
      <p className="px-4 pb-3 text-xs text-muted-foreground">
        Bevestig zodra de betaling via Tikkie binnen is; de coins worden dan bijgeschreven.
      </p>
      {purchases.length === 0 ? (
        <p className="px-4 pb-4 text-sm italic text-muted-foreground">
          Geen openstaande aankopen.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 px-4 pb-4">
          {purchases.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
            >
              <span className="flex-1 truncate font-medium">{p.username}</span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Coins className="h-4 w-4" />
                {p.coins} coins / 1 euro
              </span>
              <Button
                size="sm"
                onClick={() => onConfirm(p.id)}
                disabled={busy}
                className="shrink-0 gap-1"
              >
                <CheckCircle className="h-4 w-4" />
                Bevestig
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Challenge status -------------------------------------------------------

function ChallengePanel({
  roster,
  statuses,
  busy,
  onDeclare,
}: {
  roster: string[];
  statuses: Record<string, ChallengeStatus>;
  busy: boolean;
  onDeclare: (username: string, status: ChallengeStatus) => void;
}) {
  if (roster.length === 0) return null;
  return (
    <div className="w-full max-w-md rounded-xl border bg-card">
      <div className="flex items-center gap-2 p-4 pb-2">
        <Target className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Challenges</h3>
      </div>
      <p className="px-4 pb-3 text-xs text-muted-foreground">
        Zet de status van elke challenge; dit rekent lopende challenge-inzetten meteen af.
      </p>
      <div className="flex flex-col gap-1.5 px-4 pb-4">
        {roster.map((name) => {
          const status = statuses[name] ?? "pending";
          return (
            <div
              key={name}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
            >
              <span className="flex-1 truncate font-medium">{name}</span>
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => onDeclare(name, "completed")}
                  disabled={busy}
                  aria-label={`${name} challenge gehaald`}
                  className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
                    status === "completed"
                      ? "bg-green-500 text-white"
                      : "border text-muted-foreground hover:bg-green-50 active:bg-green-100"
                  }`}
                >
                  <CheckCircle className="h-5 w-5" />
                </button>
                <button
                  onClick={() => onDeclare(name, "failed")}
                  disabled={busy}
                  aria-label={`${name} challenge mislukt`}
                  className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
                    status === "failed"
                      ? "bg-red-500 text-white"
                      : "border text-muted-foreground hover:bg-red-50 active:bg-red-100"
                  }`}
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Live activity feed -----------------------------------------------------

const KIND_ICON = {
  bet: Coins,
  minigame: Gamepad2,
  purchase: ShoppingBag,
  gift: Gift,
} as const;

const KIND_COLOR = {
  bet: "text-amber-600",
  minigame: "text-violet-600",
  purchase: "text-primary",
  gift: "text-rose-600",
} as const;

function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="w-full max-w-md rounded-xl border bg-card">
      <div className="flex items-center gap-2 p-4 pb-2">
        <Activity className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Live activiteit</h3>
      </div>
      {events.length === 0 ? (
        <p className="px-4 pb-4 text-sm italic text-muted-foreground">
          Nog geen activiteit.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {events.map((e) => {
            const Icon = KIND_ICON[e.kind] ?? Activity;
            const color = KIND_COLOR[e.kind] ?? "text-muted-foreground";
            return (
              <li key={e.id} className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
                <span className="flex-1">
                  <span className="font-medium">{e.username}</span> {e.text}
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  {timeAgo(e.created_at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// A compact "how long ago" label (nl). Recomputed each poll via re-render.
function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 5) return "net";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}u`;
}
