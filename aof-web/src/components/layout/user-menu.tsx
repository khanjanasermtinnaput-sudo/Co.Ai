"use client";

import Link from "next/link";
import { CreditCard, LogOut, Settings, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UserMenuProps {
  expanded?: boolean;
  name?: string;
  email?: string;
}

export function UserMenu({
  expanded = false,
  name = "Aof User",
  email = "you@aof.ai",
}: UserMenuProps) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex items-center gap-3 rounded-xl text-left transition-colors hover:bg-white/5",
            expanded ? "w-full p-2" : "size-10 justify-center p-0",
          )}
        >
          <Avatar className="size-9 ring-1 ring-white/10">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          {expanded && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2 py-2.5">
          <Avatar className="size-8">
            <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          </div>
        </DropdownMenuLabel>
        <div className="px-2 pb-1.5">
          <Badge variant="default" className="gap-1">
            <Sparkles className="size-3" /> Free plan
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=account">
            <UserRound /> Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=billing">
            <CreditCard /> Billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive">
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
