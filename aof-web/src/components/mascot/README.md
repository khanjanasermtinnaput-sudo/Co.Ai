# TAOTAO — the in-chat Aof AI pixel mascot

TAOTAO is a gray British Shorthair who **lives inside the chat**, not in a panel.
There is no showcase page, no sidebar entry, no cards, no status screens — the
user sees the chat, the input box, and TAOTAO. Nothing else.

The cat is generated from pixel geometry (no image assets) and drawn as crisp
1×1 SVG cells: pixel-perfect, scalable, GPU-accelerated (transform/opacity only),
seamless loops, SSR-safe, and honors `prefers-reduced-motion`.

## Design

Solid gray fur · round face · big amber eyes · tiny pink nose · short tail.
The only accessory is a simple **purple collar** with a metallic tag (engraved
"TAOTAO" — brand metadata; below legible resolution at 32×32). No clothes, no
hoodie, no props beyond what a beat needs.

## Two touch-points

### 1. On the input box — `<ComposerMascot>`

Wrap the composer; the cat sits on its top border and never covers the field:

```tsx
import { ComposerMascot } from "@/components/mascot";

<ComposerMascot state={mascotState}>
  <Composer … />
</ComposerMascot>;
```

| `state`      | What you see                                                          |
| ------------ | -------------------------------------------------------------------- |
| `waiting`    | one cat on the border, gently cycling: sit · yarn · sleep (ZZZ) · box |
| `processing` | **two** cats on opposite ends tossing a red yarn ball over the box    |
| `error`      | one sad cat, folded ears, looking down, small blue tears             |
| `quota`      | one sad cat beside an empty food bowl, a tiny blue tear              |

In the chat the state is derived from the store: `streaming → processing`,
provider error `AOF_ERROR_004 → quota`, any other error `→ error`, else
`waiting`.

### 2. Beside the AI message — `<TaotaoAvatar>`

TAOTAO **is** the assistant avatar and reacts to the latest reply:

```tsx
import { TaotaoAvatar } from "@/components/mascot";

<TaotaoAvatar message={message} isLast={isLast} />;
```

- thinking (no tokens yet) → curious
- writing (streaming) → focused "coding" face, ears twitch, tail moves, blinks
- success (done) → wink + smile with a soft sparkle
- error → sad

Only the latest message animates; older avatars stay calm.

## Files

```
mascot/
├── index.ts             # public API
├── composer-mascot.tsx  # <ComposerMascot> — cat(s) on the input box
├── message-mascot.tsx   # <TaotaoAvatar> — cat beside the AI message
├── taotao-sprite.tsx    # generated pixel cat (parts in named <g> groups)
├── effects.tsx          # yarn, box, bowl, ZZZ, tears, sparkles
├── palette.ts           # colors + emotion → expression library
├── pixel.ts             # pixel geometry helpers
└── mascot.css           # keyframes (breathe, twitch, wag, blink, yarn-cross…)
```

`TaotaoSprite` (with the `EMOTIONS` library) is exported for any future
single-pose need. `scripts/preview-taotao.mjs` rasterizes the geometry to a PNG
for visual QA (dev-only, never imported at runtime).
