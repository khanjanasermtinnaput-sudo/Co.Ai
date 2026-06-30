"use client";

// Phase 71 — AI Cloud Workspace
// Sync and restore the full workspace across devices automatically.

import { useState } from "react";
import { Cloud, RefreshCw, Monitor, Wifi, WifiOff, CheckCircle, Clock, Smartphone, Laptop } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface WorkspaceDevice {
  id: string;
  name: string;
  type: "desktop" | "laptop" | "mobile";
  lastSeen: string;
  active: boolean;
}

interface WorkspaceSnapshot {
  id: string;
  label: string;
  timestamp: string;
  filesCount: number;
  openTabs: string[];
}

const MOCK_DEVICES: WorkspaceDevice[] = [
  { id: "1", name: "This device", type: "laptop", lastSeen: "now", active: true },
  { id: "2", name: "Home Desktop", type: "desktop", lastSeen: "2h ago", active: false },
  { id: "3", name: "MacBook Pro", type: "laptop", lastSeen: "yesterday", active: false },
];

const MOCK_SNAPSHOTS: WorkspaceSnapshot[] = [
  { id: "1", label: "Auto-save", timestamp: "Just now", filesCount: 24, openTabs: ["src/app/page.tsx", "src/components/header.tsx"] },
  { id: "2", label: "Before refactor", timestamp: "1h ago", filesCount: 22, openTabs: ["src/app/layout.tsx"] },
  { id: "3", label: "Feature: auth", timestamp: "Yesterday", filesCount: 18, openTabs: ["src/lib/auth.ts"] },
];

interface CloudWorkspacePanelProps {
  className?: string;
}

export function CloudWorkspacePanel({ className }: CloudWorkspacePanelProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"synced" | "pending" | "offline">("synced");
  const [activeTab, setActiveTab] = useState<"devices" | "history">("devices");

  async function handleSync() {
    setSyncing(true);
    await new Promise((r) => setTimeout(r, 1500));
    setSyncing(false);
    setSyncStatus("synced");
  }

  const DEVICE_ICONS = { desktop: Monitor, laptop: Laptop, mobile: Smartphone };

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Cloud className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Cloud Workspace</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn("flex items-center gap-1", syncStatus === "synced" ? "text-emerald-400" : syncStatus === "offline" ? "text-red-400" : "text-amber-400")}>
            {syncStatus === "synced" ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
            <span className="text-[10px]">{syncStatus === "synced" ? "Synced" : syncStatus === "offline" ? "Offline" : "Pending"}</span>
          </div>
          <Button size="sm" variant="ghost" onClick={handleSync} disabled={syncing} className="h-6 px-2 text-[11px]">
            <RefreshCw className={cn("size-3", syncing && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Sync Banner */}
      {syncStatus === "synced" && (
        <div className="flex items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/5 px-4 py-2">
          <CheckCircle className="size-3 text-emerald-400" />
          <span className="text-[11px] text-emerald-400">Workspace synchronized · Resume from any device instantly</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border/40 bg-card/20">
        {(["devices", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTab(t)}
            className={cn(
              "flex-1 py-2 text-[11px] font-medium capitalize transition-colors",
              activeTab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "devices" ? "Devices" : "Version History"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {activeTab === "devices" ? (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1 pb-1">Connected Devices</p>
            {MOCK_DEVICES.map((device) => {
              const Icon = DEVICE_ICONS[device.type];
              return (
                <div
                  key={device.id}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                    device.active
                      ? "border-primary/30 bg-primary/5"
                      : "border-border/40 bg-card/30 hover:bg-card/50",
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", device.active ? "text-primary" : "text-muted-foreground/60")} />
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-medium", device.active ? "text-foreground" : "text-muted-foreground")}>{device.name}</p>
                    <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                      <Clock className="size-2.5" />
                      {device.lastSeen}
                    </p>
                  </div>
                  {device.active && (
                    <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">ACTIVE</span>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1 pb-1">Workspace Snapshots</p>
            {MOCK_SNAPSHOTS.map((snap) => (
              <div key={snap.id} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 hover:bg-card/50 transition-colors cursor-pointer group">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-foreground">{snap.label}</p>
                  <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] opacity-0 group-hover:opacity-100 transition-opacity">
                    Restore
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                  <Clock className="size-2.5" />
                  {snap.timestamp} · {snap.filesCount} files
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {snap.openTabs.map((t) => (
                    <span key={t} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/70">{t.split("/").pop()}</span>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border/40 px-4 py-2.5 flex items-center justify-between bg-card/20">
        <span className="text-[10px] text-muted-foreground/50">Auto-backup every 5 min</span>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={handleSync}>
          Sync Now
        </Button>
      </div>
    </div>
  );
}
