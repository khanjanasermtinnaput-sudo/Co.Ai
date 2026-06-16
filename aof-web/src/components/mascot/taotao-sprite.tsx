"use client";

/**
 * TAOTAO — the sprite.
 *
 * The whole cat is generated from pixel geometry (no image assets), drawn as
 * crisp 1×1 SVG cells. Parts live in named <g> groups so the CSS layer can
 * animate them independently (breathing, ear-twitch, tail-wag, blink). The face
 * is parametric — every emotion in the library is composed from eye / mouth /
 * brow primitives rather than a sprite sheet.
 */

import { useMemo } from "react";
import {
  PALETTE,
  EMOTIONS,
  type Emotion,
  type Expression,
  type EyeShape,
  type MouthShape,
  type PaletteKey,
} from "./palette";
import {
  circle,
  ellipse,
  intersect,
  outline,
  rect,
  subtract,
  triangle,
  union,
  type Px,
} from "./pixel";

// ── Static silhouette geometry (computed once) ──────────────────────────────

const head = ellipse(16, 12, 9, 7);
const cheekL = circle(8, 15, 3.2);
const cheekR = circle(24, 15, 3.2);
const torso = ellipse(16, 26, 8.5, 6);

const earOuterL = triangle({ x: 5, y: 8 }, { x: 11, y: 8 }, { x: 7, y: 1 });
const earOuterR = triangle({ x: 21, y: 8 }, { x: 27, y: 8 }, { x: 25, y: 1 });
const earInnerL = triangle({ x: 7, y: 7 }, { x: 10, y: 7 }, { x: 8, y: 3 });
const earInnerR = triangle({ x: 22, y: 7 }, { x: 25, y: 7 }, { x: 24, y: 3 });

const bodyNoEars = union(head, cheekL, cheekR, torso);
const ears = union(earOuterL, earOuterR);
const silhouette = union(bodyNoEars, ears);

const bodyOutline = outline(bodyNoEars);
const earOutline = outline(ears);

// Soft volume: light forehead + light belly/muzzle, dark bottom rim.
const foreheadLight = intersect(bodyNoEars, ellipse(16, 6, 4, 2));
const bellyLight = intersect(bodyNoEars, ellipse(16, 27, 4.5, 2.5));
const muzzleLight = intersect(bodyNoEars, ellipse(16, 16, 5, 2));
const bottomShade = subtract(
  intersect(bodyNoEars, ellipse(16, 30, 7, 2)),
  bellyLight,
);
const sideShade = subtract(
  intersect(bodyNoEars, union(ellipse(8, 17, 2, 3), ellipse(24, 17, 2, 3))),
  union(foreheadLight, muzzleLight),
);

// Purple collar band around the neck + metallic engraved tag.
const collarBand = intersect(silhouette, rect(8, 18, 16, 2));
const collarShade = intersect(silhouette, rect(8, 19, 16, 1));
const tagPlate: Px[] = [
  { x: 15, y: 20 },
  { x: 16, y: 20 },
  { x: 15, y: 21 },
  { x: 16, y: 21 },
];

// Tail (own group, wags). Pixels form a hook curling up off the right hip.
const tailFill: Px[] = [
  { x: 24, y: 28 },
  { x: 25, y: 27 },
  { x: 26, y: 26 },
  { x: 27, y: 25 },
  { x: 27, y: 24 },
  { x: 26, y: 23 },
  { x: 25, y: 23 },
  { x: 24, y: 24 },
];
const tailOutline = subtract(outline(tailFill), bodyNoEars);

// Front paws.
const paws = union(rect(11, 30, 4, 2), rect(17, 30, 4, 2));
const pawToes: Px[] = [
  { x: 12, y: 31 },
  { x: 19, y: 31 },
];

// ── Run-length merge so a row of same-colored pixels is one <rect> ──────────

interface Run {
  x: number;
  y: number;
  w: number;
}

function runs(pixels: Px[]): Run[] {
  const byRow = new Map<number, number[]>();
  for (const p of pixels) {
    const row = byRow.get(p.y) ?? [];
    row.push(p.x);
    byRow.set(p.y, row);
  }
  const out: Run[] = [];
  for (const [y, xsRaw] of byRow) {
    const xs = [...new Set(xsRaw)].sort((a, b) => a - b);
    let start = xs[0];
    let prev = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      const x = xs[i];
      if (x === prev + 1) {
        prev = x;
        continue;
      }
      out.push({ x: start, y, w: prev - start + 1 });
      start = x;
      prev = x;
    }
  }
  return out;
}

function Layer({
  pixels,
  color,
  opacity,
}: {
  pixels: Px[];
  color: PaletteKey | string;
  opacity?: number;
}) {
  const fill = (PALETTE as Record<string, string>)[color] ?? color;
  const merged = useMemo(() => runs(pixels), [pixels]);
  return (
    <>
      {merged.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={r.w}
          height={1}
          fill={fill}
          opacity={opacity}
        />
      ))}
    </>
  );
}

// ── Parametric face ─────────────────────────────────────────────────────────

const EYE_L = 11; // left-eye left column
const EYE_R = 19; // right-eye left column

interface EyeParts {
  eye: Px[];
  pupil: Px[];
  shine: Px[];
  dark: Px[];
  lid: Px[]; // furDark heavy lid (sleepy)
  blinkable: boolean;
}

function eyeParts(shape: EyeShape, ex: number): EyeParts {
  const empty: EyeParts = {
    eye: [],
    pupil: [],
    shine: [],
    dark: [],
    lid: [],
    blinkable: false,
  };
  switch (shape) {
    case "open":
      return {
        ...empty,
        eye: rect(ex, 10, 3, 4),
        dark: rect(ex, 13, 3, 1),
        pupil: rect(ex + 1, 10, 1, 3),
        shine: [{ x: ex, y: 10 }],
        blinkable: true,
      };
    case "wide":
      return {
        ...empty,
        eye: rect(ex, 9, 3, 5),
        dark: rect(ex, 13, 3, 1),
        pupil: rect(ex + 1, 10, 1, 3),
        shine: [{ x: ex, y: 9 }],
        blinkable: true,
      };
    case "focused":
      return {
        ...empty,
        eye: rect(ex, 11, 3, 2),
        pupil: rect(ex + 1, 11, 1, 2),
        shine: [{ x: ex, y: 11 }],
        blinkable: true,
      };
    case "sleepy":
      return {
        ...empty,
        lid: rect(ex, 11, 3, 1),
        eye: rect(ex, 12, 3, 1),
        pupil: [{ x: ex + 1, y: 12 }],
        blinkable: false,
      };
    case "sad":
      return {
        ...empty,
        eye: rect(ex, 11, 3, 3),
        dark: rect(ex, 13, 3, 1),
        pupil: rect(ex + 1, 12, 1, 2),
        shine: [{ x: ex, y: 11 }],
        blinkable: true,
      };
    case "happy":
      // upward arc  ^
      return {
        ...empty,
        pupil: [
          { x: ex, y: 12 },
          { x: ex + 1, y: 11 },
          { x: ex + 2, y: 12 },
        ],
      };
    case "blink":
      return { ...empty, pupil: rect(ex, 12, 3, 1) };
    case "wink":
      // handled by caller per-side; default to closed arc here
      return {
        ...empty,
        pupil: [
          { x: ex, y: 12 },
          { x: ex + 1, y: 11 },
          { x: ex + 2, y: 12 },
        ],
      };
  }
}

function mouthPixels(shape: MouthShape): Px[] {
  switch (shape) {
    case "neutral":
      return [
        { x: 15, y: 16 },
        { x: 16, y: 16 },
      ];
    case "smile":
      return [
        { x: 14, y: 16 },
        { x: 15, y: 17 },
        { x: 16, y: 17 },
        { x: 17, y: 16 },
      ];
    case "bigSmile":
      return [
        { x: 13, y: 16 },
        { x: 14, y: 17 },
        { x: 15, y: 18 },
        { x: 16, y: 18 },
        { x: 17, y: 17 },
        { x: 18, y: 16 },
      ];
    case "open":
      return rect(15, 16, 2, 2);
    case "frown":
      return [
        { x: 14, y: 17 },
        { x: 15, y: 16 },
        { x: 16, y: 16 },
        { x: 17, y: 17 },
      ];
  }
}

function browPixels(expr: Expression): Px[] {
  if (expr.brow) {
    // lowered, angled toward the nose — focused / coding
    return [
      { x: 11, y: 9 },
      { x: 12, y: 9 },
      { x: 13, y: 10 },
      { x: 18, y: 10 },
      { x: 19, y: 9 },
      { x: 20, y: 9 },
    ];
  }
  if (expr.browRaise) {
    return union(rect(11, 8, 3, 1), rect(18, 8, 3, 1));
  }
  return [];
}

const blushPixels: Px[] = [
  { x: 9, y: 16 },
  { x: 10, y: 16 },
  { x: 21, y: 16 },
  { x: 22, y: 16 },
];

const nosePixels: Px[] = [
  { x: 15, y: 15 },
  { x: 16, y: 15 },
];

function Face({ expr }: { expr: Expression }) {
  const leftShape = expr.eyes === "wink" ? "open" : expr.eyes;
  const rightShape = expr.eyes === "wink" ? "happy" : expr.eyes;
  const left = eyeParts(leftShape, EYE_L);
  const right = eyeParts(rightShape, EYE_R);

  return (
    <g className="tao-face">
      {expr.blush && <Layer pixels={blushPixels} color="blush" opacity={0.55} />}

      {/* eyes */}
      <Layer pixels={[...left.lid, ...right.lid]} color="furDark" />
      <Layer pixels={[...left.eye, ...right.eye]} color="eye" />
      <Layer pixels={[...left.dark, ...right.dark]} color="eyeDark" />
      <Layer pixels={[...left.pupil, ...right.pupil]} color="pupil" />
      <Layer pixels={[...left.shine, ...right.shine]} color="shine" />

      {/* blink eyelids — only meaningful for open-eyed expressions */}
      {(left.blinkable || right.blinkable) && (
        <g className="tao-eyelids">
          {left.blinkable && <Layer pixels={rect(EYE_L, 9, 3, 5)} color="fur" />}
          {right.blinkable && (
            <Layer pixels={rect(EYE_R, 9, 3, 5)} color="fur" />
          )}
        </g>
      )}

      <Layer pixels={browPixels(expr)} color="mouth" />
      <Layer pixels={nosePixels} color="nose" />
      <Layer pixels={mouthPixels(expr.mouth)} color="mouth" />
    </g>
  );
}

// ── Public sprite ───────────────────────────────────────────────────────────

export interface TaotaoSpriteProps {
  emotion?: Emotion;
  /** Override the generated expression directly. */
  expression?: Expression;
  size?: number;
  /** Toggle idle ear-twitch + tail-wag + blink loops. */
  alive?: boolean;
  className?: string;
}

export function TaotaoSprite({
  emotion = "neutral",
  expression,
  size = 96,
  alive = true,
  className,
}: TaotaoSpriteProps) {
  const expr = expression ?? EMOTIONS[emotion];

  return (
    <svg
      width={size}
      height={size}
      viewBox="-1 -1 34 34"
      shapeRendering="crispEdges"
      className={`tao-sprite${alive ? " tao-alive" : ""}${
        className ? ` ${className}` : ""
      }`}
      role="img"
      aria-label={`TAOTAO the cat, ${emotion}`}
    >
      {/* tail (wags) */}
      <g className="tao-tail">
        <Layer pixels={tailOutline} color="outline" />
        <Layer pixels={tailFill} color="fur" />
        <Layer pixels={[{ x: 26, y: 24 }]} color="furLight" />
      </g>

      {/* body (breathes) */}
      <g className="tao-body">
        <Layer pixels={bodyOutline} color="outline" />
        <Layer pixels={bodyNoEars} color="fur" />
        <Layer pixels={sideShade} color="furShadow" />
        <Layer pixels={bottomShade} color="furDark" />
        <Layer pixels={foreheadLight} color="furLight" />
        <Layer pixels={muzzleLight} color="furLight" />
        <Layer pixels={bellyLight} color="furLight" />

        {/* paws */}
        <Layer pixels={outline(paws)} color="outline" />
        <Layer pixels={paws} color="furLight" />
        <Layer pixels={pawToes} color="furShadow" />

        {/* collar + tag */}
        <Layer pixels={collarBand} color="collar" />
        <Layer pixels={collarShade} color="collarDark" />
        <Layer pixels={outline(tagPlate)} color="collarDark" />
        <Layer pixels={tagPlate} color="tag" />
        <Layer pixels={[{ x: 15, y: 20 }]} color="tagGold" />

        {/* ears (twitch) */}
        <g className="tao-ears">
          <Layer pixels={earOutline} color="outline" />
          <Layer pixels={ears} color="fur" />
          <Layer pixels={union(earInnerL, earInnerR)} color="earPink" />
        </g>

        <Face expr={expr} />
      </g>
    </svg>
  );
}
