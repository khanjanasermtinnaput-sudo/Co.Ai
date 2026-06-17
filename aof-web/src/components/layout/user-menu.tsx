"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, LogIn, LogOut, Settings, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import { planFor } from "@/lib/plans";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
}

function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "A"
  );
}

export function UserMenu({ expanded = false }: UserMenuProps) {
  const { user, configured, signOut, tier } = useAuth();
  const router = useRouter();
  const planName = planFor(tier).name;

  // A "real" session only exists in live mode with a signed-in user. In demo
  // mode (or when signed out) we surface a clear Sign in button instead.
  const realSession = configured && !!user;

  const name = user?.name ?? "Aof User";
  const email = user?.email ?? "you@aof.ai";
  const avatarUrl = user?.avatarUrl;
  const initials = initialsOf(name);

  const handleLogout = async () => {
    await signOut();
    if (configured) router.replace("/login");
  };

  if (!realSession) {
    return (
      <Link
        href="/login"
        aria-label="Sign in"
        className={cn(
          "group flex items-center rounded-xl font-medium transition-colors",
          expanded
            ? "w-full gap-3 bg-primary/10 p-2.5 text-sm text-foreground hover:bg-primary/15"
            : "size-10 justify-center text-muted-foreground hover:bg-white/5",
        )}
      >
        <LogIn className="size-[18px] shrink-0 text-primary" />
        {expanded && <span>Sign in</span>}
      </Link>
    );
  }

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
            {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
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
            {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
            <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          </div>
        </DropdownMenuLabel>
        <div className="px-2 pb-1.5">
          <Badge variant="default" className="gap-1">
            <Sparkles className="size-3" /> {planName} plan
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
        <DropdownMenuItem
          onClick={handleLogout}
          className="text-destructive focus:text-destructive"
        >
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
