"use client";

// ── Cloud Environment Manager (Phase 34) ─────────────────────────────────────
// Manage environment variables: view, add, edit, delete, export to .env.local.
// Secret masking — values are hidden by default. Never logged or persisted.

import { useState, useEffect, useRef } from "react";
import { KeyRound, Eye, EyeOff, Plus, Trash2, Download, Upload, Copy, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";

interface EnvVar {
  id: string;
  key: string;
  value: string;
  revealed: boolean;
  scope: "all" | "dev" | "preview" | "production";
}

function newVar(): EnvVar {
  return { id: `ev_${Date.now()}`, key: "", value: "", revealed: false, scope: "all" };
}

export function EnvManager({ className }: { className?: string }) {
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [copied, setCopied] = useState(false);
  const fs = useCocodeIDEStore((s) => s.fs);
  const upsertFile = useCocodeIDEStore((s) => s.upsertFile);
  const initialFsRef = useRef(fs);

  // Load from virtual FS .env.local on mount only (snapshot initial FS state)
  useEffect(() => {
    const { flattenFiles } = require("@/lib/cocode/virtual-fs") as typeof import("@/lib/cocode/virtual-fs");
    const envFile = flattenFiles(initialFsRef.current).find((f) => f.path === ".env.local" || f.path === ".env");
    if (!envFile) return;
    const parsed: EnvVar[] = envFile.content
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => {
        const eq = l.indexOf("=");
        return {
          id: `ev_${Math.random()}`,
          key: l.slice(0, eq).trim(),
          value: l.slice(eq + 1).trim().replace(/^["']|["']$/g, ""),
          revealed: false,
          scope: "all" as const,
        };
      })
      .filter((v) => v.key);
    if (parsed.length) setVars(parsed);
  }, []);

  function add() { setVars((v) => [...v, newVar()]); }

  function update(id: string, field: keyof EnvVar, value: string | boolean) {
    setVars((v) => v.map((ev) => ev.id === id ? { ...ev, [field]: value } : ev));
  }

  function remove(id: string) { setVars((v) => v.filter((ev) => ev.id !== id)); }

  function toEnvContent() {
    return vars
      .filter((v) => v.key.trim())
      .map((v) => `${v.key}=${v.value}`)
      .join("\n") + "\n";
  }

  function saveToFS() { upsertFile(".env.local", toEnvContent()); }

  function download() {
    const blob = new Blob([toEnvContent()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = ".env.local"; a.click();
    URL.revokeObjectURL(url);
  }

  async function copyAll() {
    await navigator.clipboard.writeText(toEnvContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const parsed = text
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("#"))
        .map((l) => {
          const eq = l.indexOf("=");
          return {
            id: `ev_${Math.random()}`,
            key: l.slice(0, eq).trim(),
            value: l.slice(eq + 1).trim().replace(/^["']|["']$/g, ""),
            revealed: false,
            scope: "all" as const,
          };
        })
        .filter((v) => v.key);
      setVars((prev) => {
        const keys = new Set(prev.map((v) => v.key));
        return [...prev, ...parsed.filter((v) => !keys.has(v.key))];
      });
    }).catch(() => {});
  }

  const SCOPES = ["all", "dev", "preview", "production"] as const;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <KeyRound className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Environment Variables</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => void copyAll()} title="Copy .env content">
            {copied ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          </Button>
          <label className="cursor-pointer" title="Import .env file">
            <Upload className="size-3.5 text-muted-foreground hover:text-foreground" />
            <input type="file" accept=".env,.env.local,.env.example" className="hidden" onChange={handleImport} />
          </label>
          <Button size="sm" variant="ghost" onClick={download} title="Download .env.local">
            <Download className="size-3.5" />
          </Button>
          <Button size="sm" variant="secondary" onClick={saveToFS}>
            Save to FS
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Header */}
        <div className="grid grid-cols-[1fr_1fr_80px_32px] gap-2 border-b border-border/40 bg-card/20 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
          <span>Key</span>
          <span>Value</span>
          <span>Scope</span>
          <span />
        </div>

        {vars.map((ev) => (
          <div key={ev.id} className="grid grid-cols-[1fr_1fr_80px_32px] items-center gap-2 border-b border-border/30 px-4 py-2">
            <input
              type="text"
              value={ev.key}
              onChange={(e) => update(ev.id, "key", e.target.value)}
              placeholder="MY_VAR"
              className="rounded border border-border/40 bg-background/30 px-2 py-1 font-mono text-[12px] outline-none focus:border-primary/40"
            />
            <div className="flex items-center gap-1">
              <input
                type={ev.revealed ? "text" : "password"}
                value={ev.value}
                onChange={(e) => update(ev.id, "value", e.target.value)}
                placeholder="value"
                className="min-w-0 flex-1 rounded border border-border/40 bg-background/30 px-2 py-1 font-mono text-[12px] outline-none focus:border-primary/40"
              />
              <button type="button" onClick={() => update(ev.id, "revealed", !ev.revealed)}
                className="shrink-0 text-muted-foreground hover:text-foreground">
                {ev.revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
            <select
              value={ev.scope}
              onChange={(e) => update(ev.id, "scope", e.target.value)}
              className="rounded border border-border/40 bg-background/30 px-1 py-1 text-[11px] outline-none capitalize"
            >
              {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" onClick={() => remove(ev.id)}
              className="text-muted-foreground/50 hover:text-red-400">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}

        <div className="p-3">
          <Button size="sm" variant="secondary" onClick={add} className="w-full">
            <Plus className="size-3.5" /> Add Variable
          </Button>
        </div>

        {vars.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <KeyRound className="size-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium">No Environment Variables</p>
              <p className="mt-1 text-[12px] text-muted-foreground/60">
                Add variables or import an existing .env file.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
