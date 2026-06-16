"use client";

/**
 * TAOTAO — minimal pixel props for the in-chat companion.
 * Just the few things the spec calls for: a red yarn ball, a small cardboard
 * box, an empty food bowl, sleepy ZZZ, blue tears and a success sparkle.
 * Everything else (the chat + input box) stays the focus.
 */

const cs = { shapeRendering: "crispEdges" as const };

export function YarnBall({ size = 16 }: { size?: number }) {
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

/** Small open cardboard box TAOTAO can sit inside. */
export function CardboardBox({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.46} viewBox="0 0 24 11" {...cs} aria-hidden>
      <rect x="2" y="3" width="20" height="8" fill="#caa472" />
      <rect x="2" y="3" width="20" height="1" fill="#e0c191" />
      <rect x="2" y="10" width="20" height="1" fill="#a07c4a" />
      <rect x="1" y="2" width="5" height="2" fill="#b08a55" />
      <rect x="18" y="2" width="5" height="2" fill="#b08a55" />
    </svg>
  );
}

export function FoodBowl({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.55} viewBox="0 0 16 9" {...cs} aria-hidden>
      <ellipse cx="8" cy="3" rx="7" ry="2" fill="#1f2430" />
      <path d="M1 3 Q1 8 8 8 Q15 8 15 3 Z" fill="#60a5fa" />
      <path d="M2 3 Q2 7 8 7 Q14 7 14 3 Z" fill="#3b82f6" />
      <ellipse cx="8" cy="3" rx="6" ry="1.6" fill="#1f2430" />
    </svg>
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
            right: `${20 - i * 7}%`,
            top: `${10 - i * 7}%`,
            fontSize: 7 + i * 3,
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
  const pos =
    sides === "left"
      ? ["38%"]
      : sides === "right"
        ? ["58%"]
        : ["38%", "58%"];
  return (
    <>
      {pos.map((left, i) => (
        <span
          key={i}
          className="tao-tear"
          style={{ left, top: "46%", animationDelay: `${i * 0.9}s` }}
        />
      ))}
    </>
  );
}

/** A couple of soft sparkles for the success beat. */
export function Sparkles() {
  return (
    <>
      {[
        { left: "2%", top: "4%", d: "0s" },
        { left: "82%", top: "0%", d: "0.5s" },
        { left: "72%", top: "64%", d: "0.9s" },
      ].map((s, i) => (
        <svg
          key={i}
          className="tao-twinkle"
          width={8}
          height={8}
          viewBox="0 0 9 9"
          style={{ position: "absolute", left: s.left, top: s.top, animationDelay: s.d }}
          aria-hidden
        >
          <path
            d="M4.5 0 L5.4 3.6 L9 4.5 L5.4 5.4 L4.5 9 L3.6 5.4 L0 4.5 L3.6 3.6 Z"
            fill="#67e8f9"
          />
        </svg>
      ))}
    </>
  );
}
