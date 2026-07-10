"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Brain, Coins, Gamepad2, ShoppingBag, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

// `giftsCount` puts a badge on the Store tab so a drink notification is
// noticeable from any page. Admins get an extra Activity tab (badged with the
// number of coin packs waiting to be confirmed).
export default function BottomNav({
  quizHref = "/quiz",
  giftsCount = 0,
  isAdmin = false,
  activityCount = 0,
}: {
  quizHref?: string;
  giftsCount?: number;
  isAdmin?: boolean;
  activityCount?: number;
}) {
  const pathname = usePathname();
  const navItems = [
    { href: quizHref, icon: Brain, label: "Quiz", badge: 0 },
    { href: "/betje", icon: Coins, label: "Betje", badge: 0 },
    { href: "/store", icon: ShoppingBag, label: "Store", badge: giftsCount },
    { href: "/minigames", icon: Gamepad2, label: "Minigames", badge: 0 },
    { href: "/tussenstand", icon: Trophy, label: "Tussenstand", badge: 0 },
    ...(isAdmin
      ? [{ href: "/activity", icon: Activity, label: "Activity", badge: activityCount }]
      : []),
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-20 items-stretch justify-around border-t bg-background pb-[env(safe-area-inset-bottom)]">
      {navItems.map(({ href, icon: Icon, label, badge }) => (
        <Link
          key={label}
          href={href}
          aria-label={label}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors active:bg-muted",
            pathname === href ? "text-primary" : "text-muted-foreground"
          )}
        >
          <span className="relative">
            <Icon className="h-7 w-7" />
            {badge > 0 && (
              <span className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {badge}
              </span>
            )}
          </span>
          {label}
        </Link>
      ))}
    </nav>
  );
}
