"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, Coins, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

export default function BottomNav({ quizHref = "/quiz" }: { quizHref?: string }) {
  const pathname = usePathname();
  const navItems = [
    { href: quizHref, icon: Brain, label: "Quiz" },
    { href: "/betje", icon: Coins, label: "Betje" },
    { href: "/tussenstand", icon: Trophy, label: "Tussenstand" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-20 items-stretch justify-around border-t bg-background pb-[env(safe-area-inset-bottom)]">
      {navItems.map(({ href, icon: Icon, label }) => (
        <Link
          key={href}
          href={href}
          aria-label={label}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors active:bg-muted",
            pathname === href ? "text-primary" : "text-muted-foreground"
          )}
        >
          <Icon className="h-7 w-7" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
