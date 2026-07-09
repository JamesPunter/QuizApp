"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Play,
  RotateCcw,
  Lock,
  CheckCircle,
  XCircle,
  Users,
  Coins,
  Trophy,
  TrendingDown,
  Target,
} from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { useGameState } from "@/lib/useGameState";
import {
  QUIZ_WINNER_MARKET,
  QUIZ_LOSER_MARKET,
  adminAdvance,
  adminClose,
  adminDeclareChallenge,
  adminFinalize,
  adminMark,
  adminMarkBonus,
  adminReset,
  adminSettle,
  releaseName,
  type ChallengeStatus,
  type GameState,
  type Market,
  type Settlement,
} from "@/lib/api";

export default function AdminPage() {
  const router = useRouter();
  const { state, setState } = useGameState();
  // Settlement summary per market key, shown after paying that market out.
  const [settlements, setSettlements] = useState<Record<string, Settlement | null>>({});
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

  async function handleSettle(key: string) {
    if (busy) return;
    setBusy(true);
    try {
      const fresh = await adminSettle(key);
      setState(fresh);
      if (fresh.settlement) setSettlements((prev) => ({ ...prev, [key]: fresh.settlement! }));
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

  const { current_index, entry_state, total_questions, question, answers } = state;
  const isWaiting = current_index === -1;
  const isLast = current_index === total_questions - 1;
  const isBonus = question?.type === "text_bonus";
  const allMarked = answers.length === 0 || answers.every((a) => a.mark !== null);

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-1.5 px-2 text-sm font-medium text-primary">
          <ShieldCheck className="h-4 w-4" />
          <span className="max-w-[10rem] truncate">{state.you.username}</span>
        </div>
        <div className="flex items-center gap-1">
          {!isWaiting && (
            <button
              onClick={() => {
                setSettlements({});
                run(adminReset);
              }}
              aria-label="Quiz herstarten"
              className="flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
            >
              <RotateCcw className="h-5 w-5" />
              Herstarten
            </button>
          )}
          <button
            onClick={handleLogout}
            aria-label="Uitloggen"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
          >
            <LogOut className="h-6 w-6" />
          </button>
        </div>
      </header>

      <div className="flex w-full justify-center px-6 pt-2">
        <PresencePanel players={state.players} present={state.present} />
      </div>

      <main className="flex flex-1 flex-col items-center justify-center gap-5 p-6">
        {isWaiting ? (
          <>
            <div className="text-center">
              <p className="text-lg font-medium">Klaar om te starten</p>
              <p className="mt-1 text-sm text-muted-foreground">
                De spelers wachten. Druk op Start om de eerste vraag te tonen.
              </p>
            </div>
            <Button
              onClick={() => run(() => adminAdvance(0))}
              disabled={busy || total_questions === 0}
              size="lg"
              className="w-full max-w-md gap-1.5"
            >
              <Play className="h-5 w-5" />
              Quiz starten
            </Button>
          </>
        ) : question ? (
          <>
            <div className="w-full max-w-md text-center">
              <p className="text-sm text-muted-foreground">
                Vraag {current_index + 1} van {total_questions}
              </p>
              <h2 className="mt-2 text-xl font-semibold leading-tight">{question.text}</h2>
            </div>

            <div className="w-full max-w-md">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <Users className="h-4 w-4 text-muted-foreground" />
                {entry_state === "open"
                  ? `Live antwoorden (${answers.length})`
                  : entry_state === "closed"
                  ? `Antwoorden nakijken (${answers.length})`
                  : `Uitslag (${answers.length})`}
              </div>

              {answers.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">Nog geen antwoorden.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {answers.map(({ username, answer, bonus_answer, mark, bonus_mark }) => (
                    <div
                      key={username}
                      className="flex flex-col gap-1.5 rounded-md border bg-card px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-20 shrink-0 truncate font-medium">{username}</span>
                        <span className="flex-1 truncate text-muted-foreground">
                          &ldquo;{answer}&rdquo;
                        </span>

                        {entry_state === "closed" && (
                          <MarkButtons
                            mark={mark}
                            onCorrect={() => run(() => adminMark(username, true))}
                            onWrong={() => run(() => adminMark(username, false))}
                            correctLabel={`${username} goed rekenen`}
                            wrongLabel={`${username} fout rekenen`}
                          />
                        )}
                        {entry_state === "finalized" && <MarkIcon mark={mark} />}
                      </div>

                      {isBonus && (
                        <div className="flex items-center gap-2 border-t pt-1.5">
                          <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">
                            bonus
                          </span>
                          <span className="flex-1 truncate text-muted-foreground">
                            {bonus_answer ? `“${bonus_answer}”` : <em>geen</em>}
                          </span>

                          {entry_state === "closed" && (
                            <MarkButtons
                              mark={bonus_mark}
                              onCorrect={() => run(() => adminMarkBonus(username, true))}
                              onWrong={() => run(() => adminMarkBonus(username, false))}
                              correctLabel={`${username} bonus goed rekenen`}
                              wrongLabel={`${username} bonus fout rekenen`}
                            />
                          )}
                          {entry_state === "finalized" && <MarkIcon mark={bonus_mark} />}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {entry_state === "open" && (
              <Button
                variant="outline"
                onClick={() => run(adminClose)}
                disabled={busy}
                size="lg"
                className="w-full max-w-md gap-1.5"
              >
                <Lock className="h-5 w-5" />
                Inzenden sluiten
              </Button>
            )}

            {entry_state === "closed" && (
              <Button
                onClick={() => run(adminFinalize)}
                disabled={!allMarked || busy}
                size="lg"
                className="w-full max-w-md"
              >
                Uitslag afronden
              </Button>
            )}

            {entry_state === "finalized" && isLast && (
              <div className="flex w-full max-w-md flex-col gap-3">
                <PayoutMarket
                  market={state.markets.find((m) => m.key === QUIZ_WINNER_MARKET)}
                  marketKey={QUIZ_WINNER_MARKET}
                  title="Wie wint de quiz?"
                  standingLabel="de huidige stand"
                  settlement={settlements[QUIZ_WINNER_MARKET] ?? null}
                  busy={busy}
                  onSettle={() => handleSettle(QUIZ_WINNER_MARKET)}
                />
                <PayoutMarket
                  market={state.markets.find((m) => m.key === QUIZ_LOSER_MARKET)}
                  marketKey={QUIZ_LOSER_MARKET}
                  title="Wie wordt laatste?"
                  standingLabel="de laatste plaats"
                  settlement={settlements[QUIZ_LOSER_MARKET] ?? null}
                  busy={busy}
                  onSettle={() => handleSettle(QUIZ_LOSER_MARKET)}
                />
              </div>
            )}

            {entry_state === "finalized" && (
              <div className="flex w-full max-w-md gap-3">
                {isLast ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSettlements({});
                      run(adminReset);
                    }}
                    disabled={busy}
                    size="lg"
                    className="flex-1 gap-1.5"
                  >
                    <RotateCcw className="h-5 w-5" />
                    Quiz resetten
                  </Button>
                ) : (
                  <Button
                    onClick={() => run(() => adminAdvance(current_index + 1))}
                    disabled={busy}
                    size="lg"
                    className="flex-1 gap-1.5"
                  >
                    Volgende vraag
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                )}
              </div>
            )}
          </>
        ) : null}

        {!isWaiting && (
          <ChallengePanel
            roster={state.roster}
            statuses={state.challenge.statuses}
            busy={busy}
            onDeclare={(username, status) => run(() => adminDeclareChallenge(username, status))}
          />
        )}
      </main>

      <BottomNav quizHref="/admin" />
    </div>
  );
}

// A green/red correct-wrong toggle pair, reused for a question's main answer
// and (for text_bonus questions) its bonus answer.
function MarkButtons({
  mark,
  onCorrect,
  onWrong,
  correctLabel,
  wrongLabel,
}: {
  mark: boolean | null;
  onCorrect: () => void;
  onWrong: () => void;
  correctLabel: string;
  wrongLabel: string;
}) {
  return (
    <div className="flex shrink-0 gap-1.5">
      <button
        onClick={onCorrect}
        aria-label={correctLabel}
        className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
          mark === true
            ? "bg-green-500 text-white"
            : "border text-muted-foreground hover:bg-green-50 active:bg-green-100"
        }`}
      >
        <CheckCircle className="h-5 w-5" />
      </button>
      <button
        onClick={onWrong}
        aria-label={wrongLabel}
        className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
          mark === false
            ? "bg-red-500 text-white"
            : "border text-muted-foreground hover:bg-red-50 active:bg-red-100"
        }`}
      >
        <XCircle className="h-5 w-5" />
      </button>
    </div>
  );
}

function MarkIcon({ mark }: { mark: boolean | null }) {
  return (
    <span className="shrink-0">
      {mark === true ? (
        <CheckCircle className="h-4 w-4 text-green-500" />
      ) : (
        <XCircle className="h-4 w-4 text-red-500" />
      )}
    </span>
  );
}

function PayoutMarket({
  market,
  marketKey,
  title,
  standingLabel,
  settlement,
  busy,
  onSettle,
}: {
  market: Market | undefined;
  marketKey: string;
  title: string;
  standingLabel: string;
  settlement: Settlement | null;
  busy: boolean;
  onSettle: () => void;
}) {
  const settled = market?.is_settled ?? false;
  const isWinner = marketKey === QUIZ_WINNER_MARKET;
  const Icon = isWinner ? Trophy : TrendingDown;
  return (
    <div className="w-full rounded-xl border bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <Icon className="h-5 w-5 text-amber-600" />
        <h3 className="font-semibold">{title}</h3>
      </div>
      {settled ? (
        <div className="text-sm text-muted-foreground">
          {settlement ? (
            <p>
              <span className="font-semibold text-foreground">{settlement.paid_out}</span> coins
              uitbetaald.{" "}
              {settlement.winners.length > 0
                ? `${settlement.winners.join(", ")}.`
                : "Geen uitslag (geen scores)."}{" "}
              {settlement.won_count} gewonnen / {settlement.lost_count} verloren inzet(ten).
            </p>
          ) : (
            <p>Inzetten zijn afgerekend.</p>
          )}
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Reken deze inzetten af op basis van {standingLabel} voordat je de quiz reset.
          </p>
          <Button onClick={onSettle} disabled={busy} size="lg" className="w-full gap-1.5">
            <Coins className="h-5 w-5" />
            Inzetten uitbetalen
          </Button>
        </>
      )}
    </div>
  );
}

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
  const [collapsed, setCollapsed] = useState(false);
  if (roster.length === 0) return null;
  return (
    <div className="w-full max-w-md rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Challenges</h3>
        </div>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
            collapsed ? "" : "rotate-180"
          }`}
        />
      </button>
      {!collapsed && (
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
      )}
    </div>
  );
}

function PresencePanel({ players, present }: { players: string[]; present: string[] }) {
  const presentSet = new Set(present);
  const hereCount = players.filter((p) => presentSet.has(p)).length;

  return (
    <div className="flex w-full max-w-md flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1 font-medium">
        <Users className="h-3.5 w-3.5" />
        {hereCount}/{players.length}
      </span>
      {players.map((name) => {
        const here = presentSet.has(name);
        return (
          <span key={name} className={`flex items-center gap-1 ${here ? "" : "opacity-40"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${here ? "bg-green-500" : "bg-muted-foreground"}`} />
            {name}
          </span>
        );
      })}
    </div>
  );
}
