"use client";

import { useState } from "react";
import { Taotao, TaotaoSprite, type TaotaoState } from "@/components/mascot";
import type { Emotion } from "@/components/mascot";
import { EngineerHelmet, Rocket } from "@/components/mascot";

const STATES: { id: TaotaoState; label: string; blurb: string }[] = [
  { id: "idle", label: "Idle", blurb: "Waiting for input — yarn, sleep & box loops" },
  { id: "thinking", label: "Thinking", blurb: "Two cats play catch while Aof reasons" },
  { id: "writing", label: "Writing", blurb: "Opens a tiny laptop and types the answer" },
  { id: "success", label: "Success", blurb: "Wink + thumbs-up energy, stars pop" },
  { id: "error", label: "Error", blurb: "Ears droop, blue pixel tears" },
  { id: "quota", label: "Quota", blurb: "Sits beside an empty food bowl" },
];

const EMOTIONS: Emotion[] = [
  "happy",
  "thinking",
  "curious",
  "coding",
  "sleepy",
  "excited",
  "proud",
  "focused",
  "confused",
  "surprised",
  "error",
  "sad",
  "crying",
  "success",
];

const MICRO = [
  "User hover → eyes follow cursor",
  "User typing → watches text appear",
  "Send message → jumps slightly",
  "New chat → jumps out of the box",
  "File upload → drags a file icon",
  "Code generation → wears an engineer helmet",
  "Deploy website → launches a rocket",
  "Website ready → confetti celebration",
];

export default function MascotPage() {
  const [active, setActive] = useState<TaotaoState>("idle");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      {/* hero */}
      <div className="glass relative overflow-hidden rounded-3xl border border-white/10 p-8 sm:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(600px 240px at 30% -10%, rgba(139,92,246,0.18), transparent), radial-gradient(500px 220px at 90% 120%, rgba(34,211,238,0.14), transparent)",
          }}
        />
        <div className="relative flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
          <Taotao state={active} size={140} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-300/80">
              Official Aof AI Mascot
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">TAOTAO</h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              A gray British Shorthair who lives inside the Aof AI chat and reacts
              to every stage of the workflow. Pure pixel art — no image assets,
              GPU-accelerated, seamless loops.
            </p>
          </div>
        </div>

        {/* state switcher */}
        <div className="relative mt-8 flex flex-wrap justify-center gap-2 sm:justify-start">
          {STATES.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition-all ${
                active === s.id
                  ? "border-purple-400/50 bg-purple-500/15 text-foreground"
                  : "border-border bg-card/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* all states */}
      <h2 className="mt-12 text-lg font-semibold">Workflow states</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Six states cover the entire request lifecycle.
      </p>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STATES.map((s) => (
          <div
            key={s.id}
            className="glass flex flex-col items-center rounded-2xl border border-white/10 p-6"
          >
            <div className="flex h-32 items-center justify-center">
              <Taotao state={s.id} size={96} showStatus />
            </div>
            <p className="mt-3 text-sm font-medium">{s.label}</p>
            <p className="mt-1 text-center text-xs text-muted-foreground">
              {s.blurb}
            </p>
          </div>
        ))}
      </div>

      {/* emotion library */}
      <h2 className="mt-12 text-lg font-semibold">Emotion library</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every face is generated from eye / mouth / brow primitives — 14 emotions,
        zero sprite sheets.
      </p>
      <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
        {EMOTIONS.map((e) => (
          <div
            key={e}
            className="glass flex flex-col items-center rounded-xl border border-white/10 p-3"
          >
            <TaotaoSprite emotion={e} size={64} />
            <span className="mt-1 text-[11px] capitalize text-muted-foreground">
              {e}
            </span>
          </div>
        ))}
      </div>

      {/* micro-interactions */}
      <h2 className="mt-12 text-lg font-semibold">Micro-interactions</h2>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MICRO.map((m, i) => (
          <div
            key={m}
            className="glass flex items-center gap-3 rounded-xl border border-white/10 px-4 py-3 text-sm text-muted-foreground"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/15 text-purple-300">
              {i === 5 ? (
                <EngineerHelmet size={20} />
              ) : i === 6 ? (
                <Rocket size={16} />
              ) : (
                <TaotaoSprite emotion="curious" size={26} alive={false} />
              )}
            </span>
            {m}
          </div>
        ))}
      </div>

      {/* tech */}
      <div className="glass mt-12 rounded-2xl border border-white/10 p-6">
        <h2 className="text-lg font-semibold">Technical</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Pixel-perfect SVG (32×32 grid, <code>crispEdges</code>), scalable to any
          retina size. Transform/opacity-only animation, seamless loops, honors{" "}
          <code>prefers-reduced-motion</code>. React / Next.js native, mobile &
          desktop friendly, ~0 KB of binary assets.
        </p>
      </div>
    </div>
  );
}
