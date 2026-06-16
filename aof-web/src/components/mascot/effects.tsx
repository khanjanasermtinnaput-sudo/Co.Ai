"use client";

/**
 * TAOTAO — pixel props & ambient effects.
 * Tiny self-contained SVGs (yarn, laptop, box, bowl) plus particle layers
 * (sparkles, code fragments, stars, ZZZ, tears) used by the state machine.
 */

import { useMemo } from "react";

const cs = { shapeRendering: "crispEdges" as const };

export function YarnBall({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" {...cs} aria-hidden>
      <rect x="1" y="2" width="6" height="1" fill="#ef4444" />
      <rect x="0" y="3" width="8" height="2" fill="#ef4444" />
      <rect x="1" y="5" width="6" height="1" fill="#ef4444" />
      <rect x="2" y="1" width="4" height="1" fill="#f87171" />
      <rect x="2" y="6" width="4" height="1" fill="#dc2626" />
      <rect x="2" y="3" width="1" height="2" fill="#b91c1c" />
      <rect x="5" y="2" width="1" height="3" fill="#b91c1c" />
      <rect x="3" y="2" width="2" height="1" fill="#fca5a5" />
    </svg>
  );
}

export function Laptop({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.66} viewBox="0 0 16 11" {...cs} aria-hidden>
      {/* lid */}
      <rect x="2" y="1" width="12" height="8" fill="#3b3f4a" />
      <rect x="3" y="2" width="10" height="6" className="tao-screen" fill="#22d3ee" />
      <rect x="4" y="3" width="6" height="1" fill="#0e7490" />
      <rect x="4" y="5" width="8" height="1" fill="#0e7490" />
      <rect x="4" y="7" width="4" height="1" fill="#0e7490" />
      {/* base */}
      <rect x="0" y="9" width="16" height="2" fill="#9aa2b5" />
      <rect x="1" y="9" width="14" height="1" fill="#c7cdd9" />
    </svg>
  );
}

export function CardboardBox({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.5} viewBox="0 0 24 12" {...cs} aria-hidden>
      <rect x="1" y="3" width="22" height="9" fill="#caa472" />
      <rect x="1" y="3" width="22" height="1" fill="#e0c191" />
      <rect x="1" y="11" width="22" height="1" fill="#a07c4a" />
      {/* open flaps */}
      <rect x="0" y="1" width="6" height="3" fill="#b08a55" transform="skewX(-12)" />
      <rect x="18" y="1" width="6" height="3" fill="#b08a55" transform="skewX(12)" />
      {/* AOF AI stamp */}
      <text
        x="12"
        y="9"
        textAnchor="middle"
        fontSize="3.4"
        fontFamily="var(--font-mono, monospace)"
        fontWeight="700"
        fill="#6d4f28"
      >
        AOF AI
      </text>
    </svg>
  );
}

export function FoodBowl({ size = 40, empty = true }: { size?: number; empty?: boolean }) {
  return (
    <svg width={size} height={size * 0.55} viewBox="0 0 16 9" {...cs} aria-hidden>
      <ellipse cx="8" cy="3" rx="7" ry="2" fill="#1f2430" />
      {!empty && <ellipse cx="8" cy="3" rx="5" ry="1.4" fill="#a16207" />}
      <path d="M1 3 Q1 8 8 8 Q15 8 15 3 Z" fill="#60a5fa" />
      <path d="M2 3 Q2 7 8 7 Q14 7 14 3 Z" fill="#3b82f6" />
      <ellipse cx="8" cy="3" rx="6" ry="1.6" fill="#1f2430" />
    </svg>
  );
}

export function EngineerHelmet({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.5} viewBox="0 0 16 8" {...cs} aria-hidden>
      <path d="M2 6 Q2 1 8 1 Q14 1 14 6 Z" fill="#f4c95b" />
      <rect x="1" y="6" width="14" height="1.5" fill="#eab308" />
      <rect x="7" y="1" width="2" height="5" fill="#eab308" />
    </svg>
  );
}

export function Rocket({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 14" {...cs} aria-hidden>
      <path d="M5 0 Q8 4 8 8 H2 Q2 4 5 0 Z" fill="#c7cdd9" />
      <circle cx="5" cy="5" r="1.4" fill="#22d3ee" />
      <path d="M2 8 L0 11 L2 10 Z" fill="#ef4444" />
      <path d="M8 8 L10 11 L8 10 Z" fill="#ef4444" />
      <rect x="3" y="8" width="4" height="2" fill="#9aa2b5" />
      <path d="M3 10 L5 14 L7 10 Z" className="tao-screen" fill="#f59e0b" />
    </svg>
  );
}

// ── Particle layers ─────────────────────────────────────────────────────────

type ParticleKind = "sparkle" | "code" | "star" | "dot";

const CODE_BITS = ["</>", "{ }", "()", "01", "=>", "[ ]", "##", "*"];

interface Spec {
  left: string;
  top: string;
  delay: string;
  scale: number;
  kind: ParticleKind;
  bit?: string;
  color: string;
}

const COLORS = ["#60a5fa", "#a855f7", "#22d3ee"];

function buildSpecs(count: number, kinds: ParticleKind[], seed: number): Spec[] {
  // deterministic pseudo-random so SSR and client agree
  const rand = (n: number) => {
    const v = Math.sin(seed * 99.13 + n * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  };
  return Array.from({ length: count }, (_, i) => {
    const kind = kinds[i % kinds.length];
    return {
      left: `${8 + rand(i) * 84}%`,
      top: `${6 + rand(i + 50) * 80}%`,
      delay: `${rand(i + 100) * 2.2}s`,
      scale: 0.7 + rand(i + 7) * 0.7,
      kind,
      bit: CODE_BITS[Math.floor(rand(i + 3) * CODE_BITS.length)],
      color: COLORS[Math.floor(rand(i + 9) * COLORS.length)],
    };
  });
}

function ParticleGlyph({ spec }: { spec: Spec }) {
  if (spec.kind === "code") {
    return (
      <span
        style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 9,
          fontWeight: 700,
          color: spec.color,
          textShadow: `0 0 6px ${spec.color}`,
        }}
      >
        {spec.bit}
      </span>
    );
  }
  if (spec.kind === "star") {
    return (
      <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden>
        <path
          d="M5 0 L6 4 L10 5 L6 6 L5 10 L4 6 L0 5 L4 4 Z"
          fill="#f4c95b"
        />
      </svg>
    );
  }
  if (spec.kind === "dot") {
    return (
      <span
        style={{
          width: 4,
          height: 4,
          borderRadius: 1,
          background: spec.color,
          boxShadow: `0 0 6px ${spec.color}`,
          display: "block",
        }}
      />
    );
  }
  // sparkle (4-point)
  return (
    <svg width={9} height={9} viewBox="0 0 9 9" aria-hidden>
      <path
        d="M4.5 0 L5.4 3.6 L9 4.5 L5.4 5.4 L4.5 9 L3.6 5.4 L0 4.5 L3.6 3.6 Z"
        fill={spec.color}
        style={{ filter: `drop-shadow(0 0 3px ${spec.color})` }}
      />
    </svg>
  );
}

export function Particles({
  count = 6,
  kinds = ["sparkle", "dot"],
  anim = "float",
  seed = 1,
}: {
  count?: number;
  kinds?: ParticleKind[];
  anim?: "float" | "twinkle" | "pop";
  seed?: number;
}) {
  const specs = useMemo(() => buildSpecs(count, kinds, seed), [count, kinds, seed]);
  return (
    <>
      {specs.map((s, i) => (
        <span
          key={i}
          className={`tao-particle tao-${anim}`}
          style={{
            left: s.left,
            top: s.top,
            animationDelay: s.delay,
            transform: `scale(${s.scale})`,
          }}
        >
          <ParticleGlyph spec={s} />
        </span>
      ))}
    </>
  );
}

export function Zzz() {
  return (
    <>
      {["Z", "Z", "Z"].map((z, i) => (
        <span
          key={i}
          className="tao-zzz"
          style={{
            right: `${18 - i * 6}%`,
            top: `${24 - i * 6}%`,
            fontSize: 9 + i * 3,
            animationDelay: `${i * 0.6}s`,
          }}
        >
          {z}
        </span>
      ))}
    </>
  );
}

export function Tears({ sides = "both" }: { sides?: "both" | "left" | "right" }) {
  const pos: { left: string }[] =
    sides === "left"
      ? [{ left: "36%" }]
      : sides === "right"
        ? [{ left: "60%" }]
        : [{ left: "36%" }, { left: "60%" }];
  return (
    <>
      {pos.map((p, i) => (
        <span
          key={i}
          className="tao-tear"
          style={{ left: p.left, top: "42%", animationDelay: `${i * 0.9}s` }}
        />
      ))}
    </>
  );
}
