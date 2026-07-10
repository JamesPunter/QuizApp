"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Lock, ShieldCheck, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ApiError, claimName, fetchLoginRoster, type RosterEntry } from "@/lib/api";

const ROSTER_POLL_MS = 2000;

export default function LoginPage() {
  const router = useRouter();
  const [players, setPlayers] = useState<RosterEntry[]>([]);
  const [admins, setAdmins] = useState<RosterEntry[]>([]);
  const [error, setError] = useState("");
  // The name being logged in to (password step), or null while picking a name.
  const [selected, setSelected] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  function pickName(name: string) {
    setError("");
    setPassword("");
    setSelected(name);
  }

  function backToPicker() {
    setSelected(null);
    setPassword("");
    setError("");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const data = await claimName(selected, password);
      sessionStorage.setItem("token", data.token);
      sessionStorage.setItem("username", data.username);
      router.push(data.is_admin ? "/admin" : "/quiz");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Onjuist wachtwoord.");
        setPassword("");
      } else if (err instanceof ApiError && err.status === 409) {
        setError(`${selected} is net op een ander apparaat ingelogd.`);
        loadRoster();
        backToPicker();
      } else {
        setError(err instanceof Error ? err.message : "Er ging iets mis.");
      }
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        {selected ? (
          <>
            <CardHeader>
              <CardTitle className="text-center text-2xl">Hoi {selected}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="password"
                    className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground"
                  >
                    <Lock className="h-4 w-4" />
                    Wachtwoord
                  </label>
                  <Input
                    id="password"
                    type="password"
                    autoFocus
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Jouw wachtwoord"
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={backToPicker}
                    disabled={submitting}
                    className="gap-1.5"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Terug
                  </Button>
                  <Button type="submit" disabled={submitting || !password} className="flex-1">
                    Inloggen
                  </Button>
                </div>
              </form>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="text-center text-2xl">Wie ben jij?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <NameGrid
                label="Spelers"
                icon={<User className="h-4 w-4" />}
                entries={players}
                onPick={pickName}
              />
              <NameGrid
                label="Quizmasters"
                icon={<ShieldCheck className="h-4 w-4" />}
                entries={admins}
                onPick={pickName}
              />
              {error && <p className="text-center text-sm text-destructive">{error}</p>}
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}

function NameGrid({
  label,
  icon,
  entries,
  onPick,
}: {
  label: string;
  icon: React.ReactNode;
  entries: RosterEntry[];
  onPick: (name: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {entries.map(({ name, taken }) => (
          <button
            key={name}
            type="button"
            onClick={() => onPick(name)}
            disabled={taken}
            className={`flex min-h-14 items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left text-base font-medium transition-colors ${
              taken
                ? "cursor-not-allowed border-dashed bg-muted text-muted-foreground"
                : "bg-card hover:bg-accent active:bg-accent"
            }`}
          >
            <span className="truncate">{name}</span>
            {taken ? (
              <Lock className="h-4 w-4 shrink-0" aria-label="Bezet" />
            ) : (
              <Check className="h-4 w-4 shrink-0 text-primary opacity-0" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
