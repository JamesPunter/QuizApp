"use client";

import { useState } from "react";
import { Info, Target, X } from "lucide-react";
import { challengeFor } from "@/lib/challenges";

// A small "i" button for the header of every player page. Tapping it opens a
// dialog with that player's personalized challenge. The challenge text is mock
// data for now (see lib/challenges.ts).
export default function ChallengeInfoButton({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const challenge = challengeFor(username);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Mijn challenge"
        className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
      >
        <Info className="h-6 w-6" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="challenge-title"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <h2 id="challenge-title" className="text-lg font-semibold">
                Jouw challenge
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Sluiten"
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Alleen jij ziet deze. Haal &lsquo;m om je challenge-inzet te winnen!
            </p>
            <p className="mt-3 rounded-lg bg-muted/60 px-4 py-3 text-base font-medium leading-snug">
              {challenge}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
