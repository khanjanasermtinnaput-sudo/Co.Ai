# TAOTAO — the official Aof AI pixel mascot

TAOTAO is a gray British Shorthair cat who lives inside the Aof AI chat and
reacts to every stage of the AI workflow. This folder is a **self-contained,
asset-free** mascot system: the entire cat — body, face, accessories and
particles — is generated from pixel geometry and drawn as crisp 1×1 SVG cells.

- **Pixel-perfect** — 32×32 integer grid, `shape-rendering="crispEdges"`,
  scalable to any retina size.
- **Lightweight** — no PNG/sprite-sheet/Lottie binaries (~0 KB of assets); the
  whole `/mascot` route is ~2 KB.
- **GPU-accelerated** — every animation is transform/opacity only and loops
  seamlessly. Honors `prefers-reduced-motion`.
- **React / Next.js native** — `"use client"` components, SSR-safe, mobile &
  desktop friendly.

## Quick start

```tsx
import { Taotao } from "@/components/mascot";

<Taotao state="thinking" size={96} showStatus />;
```

`state` drives the whole machine (default `"idle"`):

| State      | Scene                                                        | Status line                                       |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `idle`     | One cat, gentle bob. Cycles yarn / sleep / box / sit loops. | _TAOTAO is waiting…_                              |
| `thinking` | Two cats play catch with a yarn ball; sparkles + code bits. | rotates _Thinking… → Planning… → … → Generating…_ |
| `writing`  | Cat opens a tiny laptop and types; code particles.          | _Writing answer…_                                |
| `success`  | Wink + big smile, excited bounce, stars pop.                | _Done! Hope this helps._                         |
| `error`    | Ears droop, slow breathing, blue pixel tears.               | _Something went wrong. Please try again._        |
| `quota`    | Cat beside an empty food bowl, dim glow, a tear.            | _Quota limit reached. Please wait or upgrade._   |

Props: `size` (px, default 96), `showStatus` (render the status line),
`className`.

## Emotion library

Every face is composed from eye / mouth / brow primitives — **no sprite
sheets**. The 14 documented emotions live in `palette.ts` (`EMOTIONS`):

`happy · thinking · curious · coding · sleepy · excited · proud · focused ·
confused · surprised · error · sad · crying · success` (+ `neutral`).

Render any single pose directly:

```tsx
import { TaotaoSprite } from "@/components/mascot";

<TaotaoSprite emotion="coding" size={64} />
// or override the generated face:
<TaotaoSprite expression={{ eyes: "wink", mouth: "bigSmile", blush: true }} />
```

`alive` (default `true`) toggles the idle breathing / ear-twitch / tail-wag /
blink loops.

## Building blocks (for micro-interactions)

The spec's micro-interactions are composed from exported pieces rather than
baked into the state machine, so product surfaces can wire them to real events:

```tsx
import {
  YarnBall, Laptop, CardboardBox, FoodBowl,
  EngineerHelmet, Rocket, Particles, Zzz, Tears, TaotaoSprite,
} from "@/components/mascot";
```

| Interaction              | Compose with                                            |
| ------------------------ | ------------------------------------------------------- |
| Send message → jump      | wrap the sprite in `.tao-jump`                          |
| New chat → out of box    | `CardboardBox` + `.tao-jump`                            |
| File upload → drag file  | animate a file glyph toward `TaotaoSprite`              |
| Code generation → helmet | `EngineerHelmet` over `emotion="coding"`                |
| Deploy → rocket          | `Rocket` + `emotion="excited"`                          |
| Website ready → confetti | `Particles kinds={["star","sparkle"]} anim="pop"`       |
| Hover → eyes follow      | map cursor to a small pupil offset on `TaotaoSprite`    |

## Files

```
mascot/
├── index.ts            # public API
├── taotao.tsx          # <Taotao> state machine + status ticker
├── taotao-sprite.tsx   # generated pixel cat (parts in named <g> groups)
├── effects.tsx         # yarn, laptop, box, bowl, helmet, rocket, particles
├── palette.ts          # colors + emotion → expression library
├── pixel.ts            # pixel geometry helpers (ellipse/triangle/outline…)
└── mascot.css          # keyframes (breathe, twitch, wag, blink, glow, …)
```

`scripts/preview-taotao.mjs` rasterizes the geometry to a PNG for visual QA
(dev-only, never imported at runtime).

## Design notes

- **Coat:** British-Shorthair "blue" rendered as a cool blue-grey so TAOTAO sits
  on Aof's dark-navy / blue·purple·cyan surfaces; eyes stay amber (which also
  echoes Aof's gold accent).
- **Collar & tag:** purple collar with a metallic engraved plate. At 32×32 the
  literal "TAOTAO" engraving is below legible resolution, so the tag is a
  metallic plate with a gold highlight; the name is documented brand metadata.
- **Rive / Lottie:** the part-based group structure (`tao-body`, `tao-ears`,
  `tao-tail`, `tao-face`, `tao-eyelids`) maps 1:1 onto Rive bones / Lottie
  layers if a future hand-animated export is desired; the CSS keyframes document
  the exact timing.

## Where it's wired in

- `/mascot` — full showcase (states, emotion library, micro-interactions).
- Sidebar — a **TAOTAO** nav entry.
- Chat empty state — idle TAOTAO greets the user.
- Chat thread — thinking TAOTAO while Aof reasons before the first tokens.
