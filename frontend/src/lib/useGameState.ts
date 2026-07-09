"use client";

// Polls GET /api/game/state/ on an interval so every device stays in sync with
// the admin driving the quiz. Replaces the old localStorage + "storage" event
// approach, which only worked across tabs on one machine.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, fetchGameState, type GameState } from "./api";

const POLL_MS = 1000;

export function useGameState() {
  const router = useRouter();
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const s = await fetchGameState();
      if (mounted.current) {
        setState(s);
        setError(null);
      }
    } catch (e) {
      // Missing/expired token → back to login.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        router.replace("/login");
        return;
      }
      if (mounted.current) setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [router]);

  useEffect(() => {
    mounted.current = true;

    if (typeof window !== "undefined" && !sessionStorage.getItem("token")) {
      router.replace("/login");
      return;
    }

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [load, router]);

  // setState lets pages apply the fresh state returned by an action call
  // immediately, without waiting for the next poll.
  return { state, error, setState, refresh: load };
}
