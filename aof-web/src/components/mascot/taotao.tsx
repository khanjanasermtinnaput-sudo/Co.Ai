"use client";

/**
 * TAOTAO — the official Aof AI mascot, as a state-driven React component.
 *
 *   <Taotao state="idle" | "thinking" | "writing" | "success" | "error" | "quota" />
 *
 * Lightweight (no assets, no canvas), GPU-accelerated (transform/opacity only),
 * seamless loops, SSR-safe. Drop it anywhere in the Aof workflow.
 */

import { useEffect, useRef, useState } from "react";
import "./mascot.css";
import { TaotaoSprite } from "./taotao-sprite";
import type { Emotion } from "./palette";
import {
  CardboardBox,
  FoodBowl,
  Laptop,
  Particles,
  Tears,
  YarnBall,
  Zzz,
} from "./effects";

export type TaotaoState =
  | "idle"
  | "thinking"
  | "writing"
  | "success"
  | "error"
  | "quota";

export interface TaotaoProps {
  state?: TaotaoState;
  size?: number;
  /** Show the rotating/inline status line for the active state. */
  showStatus?: boolean;
  className?: string;
}

const THINKING_STATUS = [
  "Thinking…",
  "Planning…",
  "Researching…",
  "Coding…",
  "Testing…",
  "Generating…",
];

/** Idle scenes cycle every few seconds (spec State 1, animations A–E). */
type IdleScene = {
  emotion: Emotion;
  prop?: "yarn" | "box" | "sleep";
  glow: GlowKind;
};
const IDLE_SCENES: IdleScene[] = [
  { emotion: "happy", glow: "blue" },
  { emotion: "curious", prop: "yarn", glow: "purple" },
  { emotion: "sleepy", prop: "sleep", glow: "dim" },
  { emotion: "neutral", prop: "box", glow: "cyan" },
];

type GlowKind = "blue" | "purple" | "cyan" | "success" | "dim";

function Glow({ kind, pulse }: { kind: GlowKind; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`tao-glow tao-glow-${kind}${pulse ? " tao-glow-pulse" : ""}`}
    />
  );
}

/** Cycles through `items` on an interval. SSR-safe (starts at index 0). */
function useCycle(length: number, ms: number, active: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active || length <= 1) return;
    const id = setInterval(() => setI((v) => (v + 1) % length), ms);
    return () => clearInterval(id);
  }, [length, ms, active]);
  return i;
}

function StatusLine({
  text,
  caret,
  tone = "muted",
}: {
  text: string;
  caret?: boolean;
  tone?: "muted" | "success" | "error";
}) {
  const color =
    tone === "success"
      ? "text-emerald-400"
      : tone === "error"
        ? "text-sky-300"
        : "text-muted-foreground";
  return (
    <p
      className={`mt-2 text-center text-xs font-medium ${color}${
        caret ? " tao-caret" : ""
      }`}
    >
      {text}
    </p>
  );
}

export function Taotao({
  state = "idle",
  size = 96,
  showStatus = false,
  className,
}: TaotaoProps) {
  const stageStyle = { width: size, height: size } as const;

  // Hooks must run unconditionally and in a stable order every render.
  const sceneIdx = useCycle(IDLE_SCENES.length, 4200, state === "idle");
  const statusIdx = useCycle(THINKING_STATUS.length, 2000, state === "thinking");

  // ── IDLE ──────────────────────────────────────────────────────────────────
  if (state === "idle") {
    const scene = IDLE_SCENES[sceneIdx];
    return (
      <div className={className}>
        <div className="tao-stage tao-bob" style={stageStyle}>
          <Glow kind={scene.glow} />
          {scene.prop === "sleep" && <Zzz />}
          {scene.prop === "box" && (
            <span className="absolute -bottom-1 left-1/2 z-[2] -translate-x-1/2">
              <CardboardBox size={size * 0.92} />
            </span>
          )}
          <span className="tao-sprite-wrap">
            <TaotaoSprite emotion={scene.emotion} size={size} />
          </span>
          {scene.prop === "yarn" && (
            <span className="absolute bottom-1 right-0 z-[2]">
              <YarnBall size={size * 0.2} />
            </span>
          )}
        </div>
        {showStatus && <StatusLine text="TAOTAO is waiting…" />}
      </div>
    );
  }

  // ── THINKING (two cats playing catch) ───────────────────────────────────────
  if (state === "thinking") {
    return (
      <div className={className}>
        <div
          className="tao-stage flex items-end justify-center gap-4"
          style={{ height: size }}
        >
          <Glow kind="purple" pulse />
          <Particles count={7} kinds={["sparkle", "code", "dot"]} anim="float" seed={4} />
          <span className="tao-sprite-wrap">
            <TaotaoSprite emotion="curious" size={size * 0.8} />
          </span>
          {/* yarn arcs between the two cats */}
          <span
            className="tao-yarn"
            style={{ bottom: size * 0.45, left: "42%" }}
          >
            <YarnBall size={size * 0.16} />
          </span>
          <span className="tao-sprite-wrap" style={{ transform: "scaleX(-1)" }}>
            <TaotaoSprite emotion="curious" size={size * 0.8} />
          </span>
        </div>
        {showStatus && <StatusLine text={THINKING_STATUS[statusIdx]} caret />}
      </div>
    );
  }

  // ── WRITING (laptop + typing) ───────────────────────────────────────────────
  if (state === "writing") {
    return (
      <div className={className}>
        <div className="tao-stage" style={stageStyle}>
          <Glow kind="cyan" pulse />
          <Particles count={6} kinds={["code", "dot"]} anim="float" seed={2} />
          <span className="tao-sprite-wrap tao-type">
            <TaotaoSprite emotion="coding" size={size} />
          </span>
          <span className="absolute z-[2]" style={{ bottom: size * 0.04, left: "50%", transform: "translateX(-50%)" }}>
            <Laptop size={size * 0.5} />
          </span>
        </div>
        {showStatus && <StatusLine text="Writing answer…" caret />}
      </div>
    );
  }

  // ── SUCCESS ─────────────────────────────────────────────────────────────────
  if (state === "success") {
    return (
      <div className={className}>
        <div className="tao-stage tao-excited" style={stageStyle}>
          <Glow kind="success" pulse />
          <Particles count={7} kinds={["star", "sparkle"]} anim="pop" seed={6} />
          <span className="tao-sprite-wrap">
            <TaotaoSprite emotion="success" size={size} />
          </span>
        </div>
        {showStatus && (
          <StatusLine text="Done! Hope this helps." tone="success" />
        )}
      </div>
    );
  }

  // ── ERROR ─────────────────────────────────────────────────────────────────
  if (state === "error") {
    return (
      <div className={className}>
        <div className="tao-stage tao-sad-sink" style={stageStyle}>
          <Glow kind="dim" />
          <Tears sides="both" />
          <span className="tao-sprite-wrap">
            <TaotaoSprite emotion="error" size={size} alive={false} />
          </span>
        </div>
        {showStatus && (
          <StatusLine text="Something went wrong. Please try again." tone="error" />
        )}
      </div>
    );
  }

  // ── QUOTA EXCEEDED ──────────────────────────────────────────────────────────
  return (
    <div className={className}>
      <div className="tao-stage tao-sad-sink" style={{ width: size, height: size * 1.1 }}>
        <Glow kind="dim" />
        <Tears sides="left" />
        <span className="tao-sprite-wrap">
          <TaotaoSprite emotion="sad" size={size} alive={false} />
        </span>
        <span className="absolute z-[2]" style={{ bottom: -2, left: "54%" }}>
          <FoodBowl size={size * 0.5} empty />
        </span>
      </div>
      {showStatus && (
        <StatusLine
          text="Quota limit reached. Please wait for reset or upgrade."
          tone="error"
        />
      )}
    </div>
  );
}
