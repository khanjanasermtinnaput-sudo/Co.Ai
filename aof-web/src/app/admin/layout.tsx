"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Ticket,
  BarChart3,
  Cpu,
  Flag,
  ScrollText,
  Settings,
  Shield,
  ChevronRight,
  LogOut,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import { Logo } from "@/components/brand/logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AdminAuthGate } from "@/components/admin/admin-auth-gate";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  ownerOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard",      href: "/admin",               icon: LayoutDashboard },
  { label: "Users",          href: "/admin/users",         icon: Users },
  { label: "Subscriptions",  href: "/admin/subscriptions", icon: CreditCard },
  { label: "Redeem Codes",   href: "/admin/redeem-codes",  icon: Ticket },
  { label: "Analytics",      href: "/admin/analytics",     icon: BarChart3 },
  { label: "API Monitoring", href: "/admin/api-monitoring",icon: Cpu },
  { label: "Feature Flags",  href: "/admin/feature-flags", icon: Flag },
  { label: "System Logs",    href: "/admin/logs",          icon: ScrollText },
  { label: "Settings",       href: "/admin/settings",      icon: Settings, ownerOnly: true },
];

function AdminSidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "A";

  return (
    <aside className="flex h-dvh w-60 shrink-0 flex-col border-r border-border/50 bg-background/80 backdrop-blur-sm">
      {/* Header */}
      <div className="flex h-14 items-center gap-2 border-b border-border/50 px-4">
        <Link href="/admin" className="flex items-center gap-2">
          <Logo size={24} />
          <span className="text-sm font-semibold">Admin</span>
        </Link>
        <Badge variant="outline" className="ml-auto text-[10px] text-amber-500 border-amber-500/30 bg-amber-500/10">
          ADMIN
        </Badge>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
              {active && <ChevronRight className="ml-auto size-3.5 opacity-40" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border/50 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <Avatar className="size-7">
            <AvatarImage src={user?.avatarUrl} />
            <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium">{user?.name ?? "Admin"}</p>
            <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Sign out"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
        <Link
          href="/"
          className="mt-1 flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          <Shield className="size-3.5" />
          Back to App
        </Link>
      </div>
    </aside>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthGate>
      <div className="flex h-dvh overflow-hidden bg-background">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Top bar */}
          <header className="flex h-14 shrink-0 items-center border-b border-border/50 bg-background/80 px-6 backdrop-blur-sm">
            <div className="flex flex-1 items-center gap-2">
              <Shield className="size-4 text-amber-500" />
              <span className="text-sm font-medium text-muted-foreground">Co.AI Admin Dashboard</span>
            </div>
            <button type="button" className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors">
              <Bell className="size-4" />
            </button>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </AdminAuthGate>
  );
}
