"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  getQuizIndex,
  getQuizEntryState,
  isAdmin,
  QUIZ_INDEX_KEY,
  QUIZ_ENTRY_STATE_KEY,
} from "@/lib/quizState";

// A banner shown on the non-quiz player pages while a question is open for
// answers, so players elsewhere in the app know to head back to the quiz.
export default function LiveQuestionBanner() {
  const [live, setLive] = useState(false);

  useEffect(() => {
    const username = sessionStorage.getItem("username");
    // Admins run the quiz from /admin and never answer, so never show it there.
    if (!username || isAdmin(username)) return;

    function update() {
      setLive(getQuizIndex() >= 0 && getQuizEntryState() === "open");
    }
    update();

    function onStorage(e: StorageEvent) {
      if (e.key === QUIZ_INDEX_KEY || e.key === QUIZ_ENTRY_STATE_KEY) update();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!live) return null;

  return (
    <Link
      href="/quiz"
      className="flex items-center gap-2 bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary-foreground" />
      </span>
      A question is live — tap to answer
      <ChevronRight className="ml-auto h-4 w-4" />
    </Link>
  );
}
