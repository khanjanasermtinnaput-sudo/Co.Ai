"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Search, RefreshCw, MoreHorizontal, UserCog, Ban, Trash2,
  Mail, Shield, Crown, ChevronLeft, ChevronRight, Filter,
} from "lucide-react";
import { adminApi } from "@/components/admin/admin-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { GrantSubscriptionDialog } from "@/components/admin/grant-subscription-dialog";
import { GrantRoleDialog } from "@/components/admin/grant-role-dialog";

interface AdminUser {
  id: string; email: string; name: string | null; avatarUrl: string | null;
  role: string; plan: string; bannedUntil: string | null;
  createdAt: string; lastSignInAt: string | null;
}

const PLAN_BADGE: Record<string, string> = {
  FREE:     "bg-muted/50 text-muted-foreground border-border/50",
  LITE:     "bg-blue-500/10 text-blue-400 border-blue-500/20",
  PRO:      "bg-violet-500/10 text-violet-400 border-violet-500/20",
  ADVANCED: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const ROLE_BADGE: Record<string, string> = {
  USER:        "bg-muted/30 text-muted-foreground",
  BETA_TESTER: "bg-teal-500/10 text-teal-400",
  STAFF:       "bg-sky-500/10 text-sky-400",
  ADMIN:       "bg-orange-500/10 text-orange-400",
  OWNER:       "bg-red-500/10 text-red-400",
};

function timeAgo(s: string | null): string {
  if (!s) return "Never";
  const diff = Date.now() - new Date(s).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d}d ago`;
  return new Date(s).toLocaleDateString();
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [grantSubUser, setGrantSubUser] = useState<AdminUser | null>(null);
  const [grantRoleUser, setGrantRoleUser] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: "20" };
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      if (planFilter) params.plan = planFilter;
      const res = await adminApi.users.list(params);
      setUsers(res.users ?? []);
      setTotal(res.total ?? 0);
      setTotalPages(res.totalPages ?? 1);
    } catch (e) {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, planFilter]);

  useEffect(() => { void load(); }, [load]);

  async function handleBan(user: AdminUser) {
    const ban = !user.bannedUntil;
    try {
      await adminApi.users.update(user.id, {
        banned: ban,
        bannedUntil: ban ? new Date(Date.now() + 365 * 86400000).toISOString() : null,
      });
      toast.success(ban ? `Banned ${user.email}` : `Unbanned ${user.email}`);
      void load();
    } catch { toast.error("Failed to update user"); }
  }

  async function handleDelete(user: AdminUser) {
    if (!confirm(`Permanently delete ${user.email}? This cannot be undone.`)) return;
    try {
      await adminApi.users.delete(user.id);
      toast.success(`Deleted ${user.email}`);
      void load();
    } catch { toast.error("Failed to delete user"); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total.toLocaleString()} total users</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by email, name, or ID…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/30"
        >
          <option value="">All Roles</option>
          {["USER","BETA_TESTER","STAFF","ADMIN","OWNER"].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          value={planFilter}
          onChange={(e) => { setPlanFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/30"
        >
          <option value="">All Plans</option>
          {["FREE","LITE","PRO","ADVANCED"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20">
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">User</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Plan</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Role</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Joined</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Last Active</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-2 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 rounded bg-muted/20 animate-pulse" style={{ width: j === 0 ? "70%" : "50%" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground text-sm">
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-7 shrink-0">
                          <AvatarImage src={user.avatarUrl ?? undefined} />
                          <AvatarFallback className="text-[10px]">
                            {(user.name ?? user.email)[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium max-w-48">{user.name ?? "—"}</p>
                          <p className="truncate text-[11px] text-muted-foreground max-w-48">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={cn("text-[10px]", PLAN_BADGE[user.plan])}>
                        {user.plan}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={cn("text-[10px]", ROLE_BADGE[user.role])}>
                        {user.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground whitespace-nowrap">
                      {timeAgo(user.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground whitespace-nowrap">
                      {timeAgo(user.lastSignInAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", user.bannedUntil
                          ? "bg-red-500/10 text-red-400 border-red-500/20"
                          : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        )}
                      >
                        {user.bannedUntil ? "Banned" : "Active"}
                      </Badge>
                    </td>
                    <td className="px-2 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="size-7">
                            <MoreHorizontal className="size-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => setGrantSubUser(user)}>
                            <CreditCard className="size-3.5" />
                            Grant Subscription
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setGrantRoleUser(user)}>
                            <Shield className="size-3.5" />
                            Change Role
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleBan(user)} className={user.bannedUntil ? "text-emerald-400" : "text-amber-400"}>
                            <Ban className="size-3.5" />
                            {user.bannedUntil ? "Unban User" : "Ban User"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDelete(user)} className="text-destructive">
                            <Trash2 className="size-3.5" />
                            Delete User
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border/50 px-4 py-3">
            <p className="text-[12px] text-muted-foreground">
              Page {page} of {totalPages} · {total.toLocaleString()} users
            </p>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading}>
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || loading}>
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {grantSubUser && (
        <GrantSubscriptionDialog
          user={grantSubUser}
          onClose={() => setGrantSubUser(null)}
          onSuccess={() => { setGrantSubUser(null); void load(); }}
        />
      )}
      {grantRoleUser && (
        <GrantRoleDialog
          user={grantRoleUser}
          onClose={() => setGrantRoleUser(null)}
          onSuccess={() => { setGrantRoleUser(null); void load(); }}
        />
      )}
    </div>
  );
}

function CreditCard({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect width="22" height="16" x="1" y="4" rx="2" /><path d="M1 10h22" /></svg>;
}
