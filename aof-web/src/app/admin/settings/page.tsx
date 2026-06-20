"use client";

import React, { useEffect, useState } from "react";
import {
  Settings, Bell, Shield, Users, AlertTriangle, RefreshCw,
  Plus, Trash2, ToggleLeft, ToggleRight, Megaphone, TestTube,
} from "lucide-react";
import { adminApi } from "@/components/admin/admin-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Announcement {
  id: string; title: string; body: string; type: string; active: boolean;
  show_on: string[]; target_tiers: string[] | null; created_at: string; ends_at: string | null;
}

const TYPE_STYLES: Record<string, string> = {
  maintenance: "bg-amber-500/10 text-amber-400",
  feature: "bg-blue-500/10 text-blue-400",
  beta: "bg-violet-500/10 text-violet-400",
  promotion: "bg-emerald-500/10 text-emerald-400",
  info: "bg-muted/40 text-muted-foreground",
};

export default function SettingsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [roles, setRoles] = useState<Array<{ user_id: string; role: string; email: string | null; granted_at?: string }>>([]);

  async function loadData() {
    setLoading(true);
    try {
      const [annoRes, rolesRes] = await Promise.allSettled([
        adminApi.announcements.list(false),
        adminApi.roles.list(),
      ]);
      if (annoRes.status === "fulfilled") setAnnouncements(annoRes.value.announcements ?? []);
      if (rolesRes.status === "fulfilled") setRoles(rolesRes.value.roles ?? []);
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { void loadData(); }, []);

  async function handleToggleAnnouncement(a: Announcement) {
    try {
      await adminApi.announcements.update(a.id, { active: !a.active });
      toast.success(a.active ? "Announcement hidden" : "Announcement activated");
      void loadData();
    } catch { toast.error("Failed to update announcement"); }
  }

  async function handleDeleteAnnouncement(a: Announcement) {
    if (!confirm("Delete this announcement?")) return;
    try {
      await adminApi.announcements.delete(a.id);
      toast.success("Deleted");
      void loadData();
    } catch { toast.error("Failed to delete"); }
  }

  async function handleRevokeRole(userId: string, role: string) {
    if (!confirm(`Remove ${role} role?`)) return;
    try {
      await adminApi.roles.revoke(userId);
      toast.success("Role removed");
      void loadData();
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">Platform Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage announcements, team roles, and platform controls</p>
      </div>

      {/* Announcements */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-primary" />
            <h2 className="font-semibold">Announcements</h2>
            <Badge variant="outline" className="text-[10px]">{announcements.filter((a) => a.active).length} active</Badge>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="size-3.5" />
            New Announcement
          </Button>
        </div>

        <div className="space-y-2">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 rounded-xl border border-border/50 bg-card/30 animate-pulse" />)
          ) : announcements.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/50 py-10 text-center">
              <p className="text-sm text-muted-foreground">No announcements yet</p>
            </div>
          ) : announcements.map((a) => (
            <div key={a.id} className={cn("flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
              a.active ? "border-primary/20 bg-primary/5" : "border-border/50 bg-card/30 opacity-60"
            )}>
              <Switch checked={a.active} onCheckedChange={() => handleToggleAnnouncement(a)} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13px] font-medium truncate">{a.title}</p>
                  <Badge variant="outline" className={cn("text-[9px]", TYPE_STYLES[a.type])}>{a.type}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {a.show_on.join(", ")}
                  {a.target_tiers ? ` · ${a.target_tiers.join(", ")}` : " · All users"}
                  {a.ends_at ? ` · Ends ${new Date(a.ends_at).toLocaleDateString()}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => handleDeleteAnnouncement(a)} className="shrink-0 rounded p-1 text-muted-foreground/40 hover:text-red-400 transition-colors">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Team roles */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-primary" />
          <h2 className="font-semibold">Admin Team</h2>
          <Badge variant="outline" className="text-[10px]">{roles.length} members</Badge>
        </div>

        <div className="rounded-xl border border-border/50 overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-2">{Array.from({length:3}).map((_,i)=><div key={i} className="h-10 rounded bg-muted/20 animate-pulse"/>)}</div>
          ) : roles.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No elevated roles assigned</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20">
                  <th className="px-4 py-3 text-left text-[11px] font-medium uppercase text-muted-foreground">User</th>
                  <th className="px-4 py-3 text-left text-[11px] font-medium uppercase text-muted-foreground">Role</th>
                  <th className="px-4 py-3 text-left text-[11px] font-medium uppercase text-muted-foreground">Granted</th>
                  <th className="px-2 py-3 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {roles.map((r) => (
                  <tr key={r.user_id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3 text-[13px]">{r.email ?? r.user_id.slice(0, 8) + "…"}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={cn("text-[10px]", {
                        OWNER: "bg-red-500/10 text-red-400", ADMIN: "bg-orange-500/10 text-orange-400",
                        STAFF: "bg-sky-500/10 text-sky-400", BETA_TESTER: "bg-teal-500/10 text-teal-400",
                      }[r.role] ?? "")}>{r.role}</Badge>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">
                      {r.granted_at ? new Date(r.granted_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-2 py-3">
                      {r.role !== "OWNER" && (
                        <button type="button" onClick={() => handleRevokeRole(r.user_id, r.role)} className="rounded p-1 text-muted-foreground/40 hover:text-red-400 transition-colors">
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Beta Access */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <TestTube className="size-4 text-primary" />
          <h2 className="font-semibold">Beta Features</h2>
        </div>
        <BetaAccessManager />
      </section>

      {/* Danger zone */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-red-400" />
          <h2 className="font-semibold text-red-400">Danger Zone</h2>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-400">Emergency Controls</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">These actions affect all platform users immediately.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => toast.info("Maintenance mode requires direct database access")}>
              Enable Maintenance Mode
            </Button>
            <Button variant="outline" size="sm" className="border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => toast.info("Contact support for emergency feature disabling")}>
              Emergency Disable Features
            </Button>
          </div>
        </div>
      </section>

      {showCreate && (
        <CreateAnnouncementDialog onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); void loadData(); }} />
      )}
    </div>
  );
}

function BetaAccessManager() {
  const [userId, setUserId] = useState("");
  const [feature, setFeature] = useState("titan-beta");
  const [loading, setLoading] = useState(false);

  const FEATURES = ["titan-beta", "cli-beta", "aof-code-beta", "experimental-models", "early-access"];

  async function handleGrant() {
    if (!userId.trim()) { toast.error("User ID required"); return; }
    setLoading(true);
    try {
      await adminApi.betaAccess.grant({ userId: userId.trim(), feature });
      toast.success(`Granted ${feature} to user`);
      setUserId("");
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/30 p-4 space-y-3">
      <p className="text-[12px] text-muted-foreground">Grant beta feature access to a specific user by their UUID.</p>
      <div className="flex gap-2">
        <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User UUID" className="text-sm flex-1" />
        <select
          value={feature}
          onChange={(e) => setFeature(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary/30"
        >
          {FEATURES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <Button size="sm" onClick={handleGrant} disabled={loading}>
          {loading ? "Granting…" : "Grant"}
        </Button>
      </div>
    </div>
  );
}

function CreateAnnouncementDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState("info");
  const [showOn, setShowOn] = useState<string[]>(["homepage", "dashboard"]);
  const [loading, setLoading] = useState(false);

  const LOCATIONS = ["homepage", "dashboard", "chat", "aof-code"];
  const TYPES = ["info", "feature", "beta", "maintenance", "promotion"];

  function toggleLocation(loc: string) {
    setShowOn((prev) => prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]);
  }

  async function handleCreate() {
    if (!title.trim() || !content.trim()) { toast.error("Title and content required"); return; }
    setLoading(true);
    try {
      await adminApi.announcements.create({ title, content, type, showOn });
      toast.success("Announcement created");
      onSuccess();
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Megaphone className="size-4 text-primary" />
          New Announcement
        </h2>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title" className="text-sm" />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Announcement content…" className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 resize-none h-24" />
        <div>
          <Label className="text-xs mb-1.5 block">Type</Label>
          <div className="flex gap-1.5 flex-wrap">
            {TYPES.map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} className={cn("rounded-lg border px-2.5 py-1 text-xs font-medium capitalize transition-colors", type === t ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground")}>{t}</button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Show on</Label>
          <div className="flex gap-1.5 flex-wrap">
            {LOCATIONS.map((l) => (
              <button key={l} type="button" onClick={() => toggleLocation(l)} className={cn("rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors", showOn.includes(l) ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground")}>{l}</button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleCreate} disabled={loading}>{loading ? "Creating…" : "Publish"}</Button>
        </div>
      </div>
    </div>
  );
}
