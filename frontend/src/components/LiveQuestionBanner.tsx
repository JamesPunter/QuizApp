"use client";

import Link from "next/link";

// Shown on the non-quiz player pages while a question is open, so players
// elsewhere in the app know to head back and answer. The parent page (which
// already polls game state) decides when it's live and passes it in.
export default function LiveQuestionBanner({ live }: { live: boolean }) {
  if (!live) return null;

  return (
    <Link
      href="/quiz"
      aria-label="Er is een vraag live — tik om te antwoorden"
      className="flex items-center py-1 pl-[22px]"
    >
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
      </span>
    </Link>
  );
}
