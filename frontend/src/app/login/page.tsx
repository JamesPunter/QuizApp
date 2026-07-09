"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock, ShieldCheck, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, claimName, fetchLoginRoster, type RosterEntry } from "@/lib/api";

const ROSTER_POLL_MS = 2000;

export default function LoginPage() {
  const router = useRouter();
  const [players, setPlayers] = useState<RosterEntry[]>([]);
  const [admins, setAdmins] = useState<RosterEntry[]>([]);
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState<string | null>(null);

  const loadRoster = useCallback(async () => {
    try {
      const r = await fetchLoginRoster();
      setPlayers(r.players);
      setAdmins(r.admins);
    } catch {
      // transient — keep the last good roster
    }
  }, []);

  // Poll so names taken on other devices grey out live.
  useEffect(() => {
    loadRoster();
    const id = setInterval(loadRoster, ROSTER_POLL_MS);
    return () => clearInterval(id);
  }, [loadRoster]);

  async function handlePick(name: string) {
    if (claiming) return;
    setError("");
    setClaiming(name);
    try {
      const data = await claimName(name);
      sessionStorage.setItem("token", data.token);
      sessionStorage.setItem("username", data.username);
      router.push(data.is_admin ? "/admin" : "/quiz");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(`${name} is net op een ander apparaat gekozen.`);
        loadRoster();
      } else {
        setError(err instanceof Error ? err.message : "Er ging iets mis.");
      }
      setClaiming(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-2xl">Wie ben jij?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <NameGrid
            label="Spelers"
            icon={<User className="h-4 w-4" />}
            entries={players}
            claiming={claiming}
            onPick={handlePick}
          />
          <NameGrid
            label="Quizmasters"
            icon={<ShieldCheck className="h-4 w-4" />}
            entries={admins}
            claiming={claiming}
            onPick={handlePick}
          />
          {error && <p className="text-center text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </main>
  );
}

function NameGrid({
  label,
  icon,
  entries,
  claiming,
  onPick,
}: {
  label: string;
  icon: React.ReactNode;
  entries: RosterEntry[];
  claiming: string | null;
  onPick: (name: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {entries.map(({ name, taken }) => {
          const isClaiming = claiming === name;
          const disabled = taken || (claiming !== null && !isClaiming);
          return (
            <button
              key={name}
              type="button"
              onClick={() => onPick(name)}
              disabled={disabled}
              className={`flex min-h-14 items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left text-base font-medium transition-colors ${
                taken
                  ? "cursor-not-allowed border-dashed bg-muted text-muted-foreground"
                  : "bg-card hover:bg-accent active:bg-accent disabled:opacity-60"
              }`}
            >
              <span className="truncate">{name}</span>
              {taken ? (
                <Lock className="h-4 w-4 shrink-0" aria-label="Bezet" />
              ) : isClaiming ? (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
