"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { adminApi } from "./admin-client";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";

interface User { id: string; email: string; name: string | null; plan: string; }

const DURATIONS = [
  { label: "7 Days",   days: 7 },
  { label: "30 Days",  days: 30 },
  { label: "90 Days",  days: 90 },
  { label: "180 Days", days: 180 },
  { label: "365 Days", days: 365 },
  { label: "Lifetime", days: 0 },
];

export function GrantSubscriptionDialog({
  user, onClose, onSuccess,
}: { user: User; onClose: () => void; onSuccess: () => void }) {
  const [plan, setPlan] = useState<string>("PRO");
  const [duration, setDuration] = useState<number>(30);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleGrant() {
    setLoading(true);
    try {
      await adminApi.subscriptions.grant({
        userId: user.id,
        plan,
        durationDays: duration === 0 ? undefined : duration,
        isLifetime: duration === 0,
        grantReason: reason || undefined,
      });
      toast.success(`Granted ${plan} subscription to ${user.email}`);
      onSuccess();
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to grant subscription");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="size-4 text-primary" />
            Grant Subscription
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Target user</p>
            <p className="text-sm font-medium mt-0.5">{user.name ?? user.email}</p>
            <p className="text-xs text-muted-foreground">{user.email} · Currently: {user.plan}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Plan</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {["FREE", "LITE", "PRO", "ADVANCED"].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlan(p)}
                  className={`rounded-lg border py-2 text-xs font-medium transition-colors ${
                    plan === p
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/50 bg-background text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Duration</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {DURATIONS.map(({ label, days }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDuration(days)}
                  className={`rounded-lg border py-2 text-xs font-medium transition-colors ${
                    duration === days
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/50 bg-background text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Reason (optional)</Label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this subscription being granted?"
              className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 resize-none h-16"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button onClick={handleGrant} disabled={loading}>
              {loading ? "Granting…" : "Grant Subscription"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
