"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { joinAsUser } from "@/lib/api";
import { isAdmin } from "@/lib/quizState";
import { registerPlayer } from "@/lib/bettingState";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = username.trim();
    if (!trimmed) {
      setError("Please enter a username.");
      return;
    }

    setLoading(true);
    try {
      const data = await joinAsUser(trimmed);
      sessionStorage.setItem("token", data.token);
      sessionStorage.setItem("username", data.username);
      if (!isAdmin(data.username)) registerPlayer(data.username);
      router.push(isAdmin(data.username) ? "/admin" : "/quiz");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Join the Quiz</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleJoin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                autoFocus
                disabled={loading}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? "Joining…" : "Join"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
