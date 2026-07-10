"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Beer,
  CheckCircle,
  ChevronDown,
  Coins,
  Gamepad2,
  Gift,
  LogOut,
  Martini,
  Save,
  ShieldCheck,
  ShoppingBag,
  Target,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGameState } from "@/lib/useGameState";
import {
  adminConfirmPurchase,
  adminConfirmSlotDrink,
  adminSaveChallenges,
  releaseName,
  type ActivityEvent,
  type AdminPurchase,
  type AdminSlotDrink,
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
          slotDrinks={state.pending_slot_drinks}
          busy={busy}
          onConfirm={(id) => run(() => adminConfirmPurchase(id))}
          onConfirmDrink={(id) => run(() => adminConfirmSlotDrink(id))}
        />

        <ChallengePanel
          roster={state.roster}
          statuses={state.challenge.statuses}
          busy={busy}
          onSave={(statuses) => run(() => adminSaveChallenges(statuses))}
        />

        <ActivityFeed events={state.activity} />
      </main>

      <BottomNav
        quizHref="/admin"
        giftsCount={state.you.gifts_received?.length ?? 0}
        isAdmin
        activityCount={(state.pending_purchases?.length ?? 0) + (state.pending_slot_drinks?.length ?? 0)}
      />
    </div>
  );
}

// --- Collapsible card shell -------------------------------------------------

// A bordered card whose body can be folded away by tapping its header. Each
// panel on this page manages its own open/closed state independently.
function CollapsibleCard({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="w-full max-w-md rounded-xl border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 p-4 ${open ? "pb-2" : ""}`}
      >
        <Icon className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">{title}</h3>
        <ChevronDown
          className={`ml-auto h-5 w-5 text-muted-foreground transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>
      {open && children}
    </div>
  );
}

// --- Buy requests -----------------------------------------------------------

function PurchasesPanel({
  purchases,
  slotDrinks,
  busy,
  onConfirm,
  onConfirmDrink,
}: {
  purchases: AdminPurchase[];
  slotDrinks: AdminSlotDrink[];
  busy: boolean;
  onConfirm: (id: number) => void;
  onConfirmDrink: (id: number) => void;
}) {
  const empty = purchases.length === 0 && slotDrinks.length === 0;
  return (
    <CollapsibleCard icon={ShoppingBag} title="Aankopen">
      <p className="px-4 pb-3 text-xs text-muted-foreground">
        Bevestig coins zodra de Tikkie-betaling binnen is; bevestig een gokkast-drankje
        zodra de speler het gedaan heeft (pas dan kan diegene weer spinnen).
      </p>
      {empty ? (
        <p className="px-4 pb-4 text-sm italic text-muted-foreground">
          Geen openstaande aankopen.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 px-4 pb-4">
          {purchases.map((p) => (
            <div
              key={`purchase-${p.id}`}
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
          {slotDrinks.map((d) => {
            const isShot = d.kind === "shot";
            const Icon = isShot ? Martini : Beer;
            return (
              <div
                key={`drink-${d.id}`}
                className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm dark:border-rose-900/50 dark:bg-rose-950/30"
              >
                <span className="flex-1 truncate font-medium">{d.username}</span>
                <span className="flex items-center gap-1 text-rose-600">
                  <Icon className="h-4 w-4" />
                  {isShot ? "Shot" : "Slok"} (gokkast)
                </span>
                <Button
                  size="sm"
                  onClick={() => onConfirmDrink(d.id)}
                  disabled={busy}
                  className="shrink-0 gap-1"
                >
                  <CheckCircle className="h-4 w-4" />
                  Gedaan
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleCard>
  );
}

// --- Challenge status -------------------------------------------------------

function ChallengePanel({
  roster,
  statuses,
  busy,
  onSave,
}: {
  roster: string[];
  statuses: Record<string, ChallengeStatus>;
  busy: boolean;
  onSave: (statuses: Record<string, ChallengeStatus>) => Promise<void>;
}) {
  // Verdicts are drafted locally; nothing is official (and no bet pays out)
  // until the admin taps "Opslaan", which commits the whole draft at once.
  const [draft, setDraft] = useState<Record<string, ChallengeStatus>>(statuses);
  const [dirty, setDirty] = useState(false);

  // Mirror the server's official statuses (polled every second) into the draft
  // while there are no unsaved edits; once the admin starts editing, their
  // draft is left alone until they save.
  useEffect(() => {
    if (!dirty) setDraft(statuses);
  }, [statuses, dirty]);

  if (roster.length === 0) return null;

  // Tapping the button that's already active clears the verdict back to
  // pending (gray); tapping the other one switches to it.
  function toggle(name: string, target: ChallengeStatus) {
    setDraft((d) => {
      const current = d[name] ?? "pending";
      return { ...d, [name]: current === target ? "pending" : target };
    });
    setDirty(true);
  }

  async function handleSave() {
    await onSave(draft);
    setDirty(false);
  }

  return (
    <CollapsibleCard icon={Target} title="Challenges">
      <p className="px-4 pb-3 text-xs text-muted-foreground">
        Zet de status van elke challenge en klik op Opslaan; pas dan wordt de status
        officieel en worden lopende inzetten afgerekend.
      </p>
      <div className="flex flex-col gap-1.5 px-4">
        {roster.map((name) => {
          const status = draft[name] ?? "pending";
          return (
            <div
              key={name}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
            >
              <span className="flex-1 truncate font-medium">{name}</span>
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => toggle(name, "completed")}
                  disabled={busy}
                  aria-pressed={status === "completed"}
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
                  onClick={() => toggle(name, "failed")}
                  disabled={busy}
                  aria-pressed={status === "failed"}
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
      <div className="flex items-center justify-between gap-2 px-4 pb-4 pt-3">
        <span className="text-xs text-muted-foreground">
          {dirty ? "Niet-opgeslagen wijzigingen" : "Alles opgeslagen"}
        </span>
        <Button onClick={handleSave} disabled={busy || !dirty} size="sm" className="gap-1.5">
          <Save className="h-4 w-4" />
          Opslaan
        </Button>
      </div>
    </CollapsibleCard>
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
    <CollapsibleCard icon={Activity} title="Live activiteit">
      {events.length === 0 ? (
        <p className="px-4 pb-4 text-sm italic text-muted-foreground">
          Nog geen activiteit.
        </p>
      ) : (
        <ScrollArea className="max-h-80">
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
        </ScrollArea>
      )}
    </CollapsibleCard>
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
