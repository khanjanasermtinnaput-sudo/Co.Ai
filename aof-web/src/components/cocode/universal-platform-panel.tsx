"use client";

// Phase 98 — Universal Development Platform
// CoCode supports every major development domain.
// Each platform has its own toolchain, templates, and AI agent specializations.
// Future platforms added via modular plugins (Phase 86 Marketplace).

import { useState } from "react";
import { Globe, Smartphone, Monitor, Server, Brain, Cpu, Gamepad2, Terminal, Puzzle, Layers, Package2, CheckCircle, Lock, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type PlatformStatus = "available" | "beta" | "coming-soon" | "plugin";

interface Platform {
  id: string;
  name: string;
  icon: React.ElementType;
  color: string;
  description: string;
  status: PlatformStatus;
  supportedLanguages: string[];
  aiCapabilities: string[];
  templates: string[];
}

const STATUS_CONFIG: Record<PlatformStatus, { label: string; color: string }> = {
  "available":    { label: "Available",    color: "text-emerald-400" },
  "beta":         { label: "Beta",         color: "text-blue-400"    },
  "coming-soon":  { label: "Coming Soon",  color: "text-amber-400"   },
  "plugin":       { label: "Via Plugin",   color: "text-purple-400"  },
};

const PLATFORMS: Platform[] = [
  {
    id: "web", name: "Web", icon: Globe, color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    description: "Full-stack web development: Next.js, Remix, Astro, SvelteKit, Vue, Angular.",
    status: "available",
    supportedLanguages: ["TypeScript", "JavaScript", "HTML", "CSS", "SCSS", "GraphQL"],
    aiCapabilities: ["Component generation", "API route scaffolding", "CSS animation", "SEO optimization", "Accessibility audit"],
    templates: ["Next.js 14 App Router", "Remix SPA", "Astro Static Site", "Supabase + Next.js"],
  },
  {
    id: "backend", name: "Backend", icon: Server, color: "text-primary bg-primary/10 border-primary/20",
    description: "Server-side APIs, microservices, and data pipelines.",
    status: "available",
    supportedLanguages: ["TypeScript", "Python", "Go", "Rust", "Java", "C#"],
    aiCapabilities: ["REST/GraphQL scaffolding", "Database migration generation", "Auth flow design", "Rate limiting", "Queue workers"],
    templates: ["Express + Prisma", "FastAPI + SQLAlchemy", "Go HTTP Server", "tmap-v2 agent pattern"],
  },
  {
    id: "mobile", name: "Mobile", icon: Smartphone, color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    description: "iOS, Android, and cross-platform mobile development.",
    status: "beta",
    supportedLanguages: ["Swift", "Kotlin", "TypeScript (RN)", "Dart"],
    aiCapabilities: ["Screen layout generation", "Native API integration", "Push notification flow", "App Store checklist"],
    templates: ["React Native Expo", "Flutter + Supabase", "Swift iOS", "Kotlin Android"],
  },
  {
    id: "desktop", name: "Desktop", icon: Monitor, color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    description: "Cross-platform desktop apps: Tauri, Electron, native.",
    status: "beta",
    supportedLanguages: ["TypeScript", "Rust", "C++", "C#"],
    aiCapabilities: ["Window management", "System tray integration", "Auto-updater", "Native OS API calls"],
    templates: ["Tauri + React", "Electron + Vite", ".NET WPF", "Qt C++"],
  },
  {
    id: "ai-ml", name: "AI / ML", icon: Brain, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    description: "Model training, fine-tuning, inference, and AI pipeline orchestration.",
    status: "beta",
    supportedLanguages: ["Python", "Julia", "R", "CUDA"],
    aiCapabilities: ["Dataset generation", "Model architecture suggestions", "Training script scaffolding", "Eval harness generation"],
    templates: ["HuggingFace Fine-tune", "LangChain Agent", "PyTorch Training Loop", "Inference API"],
  },
  {
    id: "iot", name: "IoT", icon: Cpu, color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    description: "Internet of Things device firmware and cloud integration.",
    status: "coming-soon",
    supportedLanguages: ["C", "C++", "MicroPython", "Rust (embedded)"],
    aiCapabilities: ["Sensor reading optimization", "MQTT broker config", "Power consumption analysis", "OTA update flow"],
    templates: ["ESP32 + MicroPython", "Raspberry Pi + Node", "Arduino Sensor Hub"],
  },
  {
    id: "game", name: "Game Development", icon: Gamepad2, color: "text-pink-400 bg-pink-500/10 border-pink-500/20",
    description: "Game logic, level design systems, and asset pipeline tooling.",
    status: "plugin",
    supportedLanguages: ["C#", "GDScript", "C++", "Lua", "TypeScript"],
    aiCapabilities: ["Game mechanic prototyping", "Shader generation", "AI behavior tree", "Procedural map generation"],
    templates: ["Unity C# Game", "Godot GDScript", "Phaser.js Web Game", "Three.js 3D Scene"],
  },
  {
    id: "cli", name: "CLI Tools", icon: Terminal, color: "text-muted-foreground bg-muted/10 border-border/30",
    description: "Command-line interface tools and developer utilities.",
    status: "available",
    supportedLanguages: ["TypeScript (Node)", "Go", "Rust", "Python", "Bash"],
    aiCapabilities: ["Argument parsing", "Interactive prompt design", "Config file management", "Shell completion"],
    templates: ["Commander.js CLI", "Cobra Go CLI", "Clap Rust CLI", "Click Python CLI"],
  },
  {
    id: "browser-ext", name: "Browser Extensions", icon: Puzzle, color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    description: "Chrome, Firefox, and Edge browser extension development.",
    status: "coming-soon",
    supportedLanguages: ["TypeScript", "JavaScript", "CSS"],
    aiCapabilities: ["Manifest V3 scaffolding", "Content script injection", "Background worker", "Popup UI generation"],
    templates: ["Chrome Extension MV3", "Firefox WebExtension", "Cross-browser Extension"],
  },
  {
    id: "embedded", name: "Embedded Systems", icon: Layers, color: "text-red-400 bg-red-500/10 border-red-500/20",
    description: "Low-level embedded system development and real-time OS.",
    status: "plugin",
    supportedLanguages: ["C", "C++", "Assembly", "Rust"],
    aiCapabilities: ["Register map generation", "Interrupt handler scaffold", "Memory layout optimization", "RTOS task design"],
    templates: ["FreeRTOS Task", "STM32 HAL", "Zephyr RTOS", "Bare-Metal ARM"],
  },
];

interface UniversalPlatformPanelProps { className?: string }

export function UniversalPlatformPanel({ className }: UniversalPlatformPanelProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const selectedPlatform = PLATFORMS.find((p) => p.id === selected);
  const availableCount = PLATFORMS.filter((p) => p.status === "available" || p.status === "beta").length;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Universal Platform</span>
        </div>
        <span className="text-[10px] text-muted-foreground/50">{availableCount}/{PLATFORMS.length} active</span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn("overflow-y-auto p-3 space-y-1.5", selected ? "w-52 shrink-0 border-r border-border/40" : "flex-1")}>
          {PLATFORMS.map((platform) => {
            const Icon = platform.icon;
            const stCfg = STATUS_CONFIG[platform.status];
            return (
              <button key={platform.id} type="button" onClick={() => setSelected(selected === platform.id ? null : platform.id)}
                className={cn("w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                  selected === platform.id ? "border-primary/30 bg-primary/5" : cn(platform.color, "hover:opacity-80"))}>
                <div className="flex items-center gap-2.5">
                  <Icon className="size-3.5 shrink-0" />
                  <span className="flex-1 font-medium text-foreground">{platform.name}</span>
                  <span className={cn("text-[9px] font-semibold shrink-0", stCfg.color)}>{stCfg.label}</span>
                </div>
                {!selected && (
                  <p className="text-[10px] text-muted-foreground/60 mt-1 leading-snug line-clamp-1">{platform.description}</p>
                )}
              </button>
            );
          })}
        </div>

        {selected && selectedPlatform && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className={cn("rounded-xl p-2.5", selectedPlatform.color)}>
                <selectedPlatform.icon className="size-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground">{selectedPlatform.name}</p>
                <span className={cn("text-[10px] font-semibold", STATUS_CONFIG[selectedPlatform.status].color)}>
                  {STATUS_CONFIG[selectedPlatform.status].label}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{selectedPlatform.description}</p>

            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground/40">Languages</p>
              <div className="flex flex-wrap gap-1">
                {selectedPlatform.supportedLanguages.map((lang) => (
                  <span key={lang} className="rounded-full bg-muted/20 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70">{lang}</span>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground/40">AI Capabilities</p>
              {selectedPlatform.aiCapabilities.map((cap) => (
                <div key={cap} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                  <CheckCircle className="size-2.5 text-primary/50 shrink-0" />{cap}
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground/40">Starter Templates</p>
              {selectedPlatform.templates.map((tmpl) => (
                <div key={tmpl} className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/30 px-2.5 py-1.5 text-[10px] text-foreground/70">
                  <Package2 className="size-3 text-muted-foreground/40 shrink-0" />{tmpl}
                </div>
              ))}
            </div>

            {selectedPlatform.status === "coming-soon" && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 flex items-center gap-2">
                <Clock className="size-3.5 text-amber-400 shrink-0" />
                <p className="text-[10px] text-amber-400/80">Coming soon — vote in the Innovation Engine to prioritize</p>
              </div>
            )}
            {selectedPlatform.status === "plugin" && (
              <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 px-3 py-2.5 flex items-center gap-2">
                <Puzzle className="size-3.5 text-purple-400 shrink-0" />
                <p className="text-[10px] text-purple-400/80">Available via AI Marketplace plugin — sandboxed, permission-gated</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
