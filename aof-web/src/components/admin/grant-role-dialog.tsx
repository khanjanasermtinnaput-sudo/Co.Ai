"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { adminApi } from "./admin-client";
import { toast } from "sonner";
import { Shield } from "lucide-react";

interface User { id: string; email: string; name: string | null; role: string; }

const ROLES = [
  { value: "STAFF",       label: "Staff",       desc: "View users & provide support" },
  { value: "BETA_TESTER", label: "Beta Tester", desc: "Access beta features" },
  { value: "ADMIN",       label: "Admin",        desc: "Full management access" },
  { value: "OWNER",       label: "Owner",        desc: "Complete platform control" },
];

export function GrantRoleDialog({
  user, onClose, onSuccess,
}: { user: User; onClose: () => void; onSuccess: () => void }) {
  const [role, setRole] = useState(user.role !== "USER" ? user.role : "STAFF");
  const [notes, setNotes] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleGrant() {
    setLoading(true);
    try {
      await adminApi.roles.grant({ userId: user.id, role, notes: notes || undefined });
      toast.success(`Granted ${role} role to ${user.email}`);
      onSuccess();
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to grant role");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke() {
    setRevoking(true);
    try {
      await adminApi.roles.revoke(user.id);
      toast.success(`Removed elevated role from ${user.email}`);
      onSuccess();
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to revoke role");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="size-4 text-primary" />
            Change Role
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">User</p>
            <p className="text-sm font-medium mt-0.5">{user.name ?? user.email}</p>
            <p className="text-xs text-muted-foreground">Current role: {user.role}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">New Role</Label>
            <div className="space-y-1.5">
              {ROLES.map(({ value, label, desc }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRole(value)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    role === value
                      ? "border-primary bg-primary/10"
                      : "border-border/50 bg-background hover:border-primary/30"
                  }`}
                >
                  <p className={`text-sm font-medium ${role === value ? "text-primary" : "text-foreground"}`}>{label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for role change…"
              className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 resize-none h-16"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            {user.role !== "USER" && (
              <Button variant="outline" onClick={handleRevoke} disabled={loading || revoking} className="text-destructive hover:text-destructive">
                {revoking ? "Revoking…" : "Remove Role"}
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" onClick={onClose} disabled={loading || revoking}>Cancel</Button>
              <Button onClick={handleGrant} disabled={loading || revoking}>
                {loading ? "Saving…" : "Set Role"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
