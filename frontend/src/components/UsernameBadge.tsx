"use client";

import { User } from "lucide-react";
import { cn } from "@/lib/utils";

export default function UsernameBadge({
  username,
  className,
}: {
  username: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-3 text-sm font-medium text-muted-foreground",
        className
      )}
    >
      <User className="h-4 w-4 shrink-0" />
      <span className="max-w-[10rem] truncate">{username}</span>
    </div>
  );
}
