/**
 * TAOTAO — color palette and emotion library.
 *
 * British Shorthair "blue" coat rendered in a cool blue-grey — a neutral tone
 * that reads fine against Co.AI's actual dark-charcoal + orange-gold theme
 * (`globals.css`'s tokens) without competing with it, while the eyes stay
 * British-Shorthair amber, which also echoes Co.AI's gold accent.
 */

export const PALETTE = {
  fur: "#8A93A8",
  furLight: "#B9C1D2",
  furDark: "#5C6477",
  furShadow: "#454C5C",
  outline: "#262B36",
  earPink: "#E59AB0",
  eye: "#F4AE3C",
  eyeDark: "#C9852A",
  pupil: "#23262E",
  shine: "#FFFFFF",
  nose: "#F2A0B5",
  mouth: "#3A3F4A",
  collar: "#8B5CF6",
  collarDark: "#6D3FD4",
  tag: "#D9DEEA",
  tagDark: "#9AA2B5",
  tagGold: "#F4C95B",
  blush: "#EC9AB0",
  tear: "#5BC8F2",
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Eye shapes drive most of the perceived emotion. */
export type EyeShape =
  | "open"
  | "happy" // upward arc ^_^
  | "blink"
  | "wink" // right eye closed
  | "sleepy" // half-lidded
  | "sad" // droopy + lower
  | "wide" // surprised
  | "focused"; // narrowed

/** Mouth shapes. */
export type MouthShape =
  | "neutral"
  | "smile"
  | "bigSmile"
  | "open" // small "o"
  | "frown";

export interface Expression {
  eyes: EyeShape;
  mouth: MouthShape;
  /** Pink blush dabs on the cheeks. */
  blush?: boolean;
  /** Brows lowered toward the nose (focused / coding). */
  brow?: boolean;
  /** Eyebrows raised (surprised / confused). */
  browRaise?: boolean;
}

/**
 * The full emotion library called for in the spec. Each maps to a parametric
 * expression — no sprite sheets required, every face is generated.
 */
export type Emotion =
  | "happy"
  | "thinking"
  | "curious"
  | "coding"
  | "sleepy"
  | "excited"
  | "proud"
  | "focused"
  | "confused"
  | "surprised"
  | "error"
  | "sad"
  | "crying"
  | "success"
  | "neutral";

export const EMOTIONS: Record<Emotion, Expression> = {
  neutral: { eyes: "open", mouth: "neutral" },
  happy: { eyes: "happy", mouth: "smile", blush: true },
  thinking: { eyes: "focused", mouth: "neutral", brow: true },
  curious: { eyes: "wide", mouth: "open", browRaise: true },
  coding: { eyes: "focused", mouth: "neutral", brow: true },
  sleepy: { eyes: "sleepy", mouth: "neutral" },
  excited: { eyes: "wide", mouth: "bigSmile", blush: true, browRaise: true },
  proud: { eyes: "happy", mouth: "smile" },
  focused: { eyes: "focused", mouth: "neutral", brow: true },
  confused: { eyes: "open", mouth: "open", browRaise: true },
  surprised: { eyes: "wide", mouth: "open", browRaise: true },
  error: { eyes: "sad", mouth: "frown" },
  sad: { eyes: "sad", mouth: "frown" },
  crying: { eyes: "sad", mouth: "frown" },
  success: { eyes: "wink", mouth: "bigSmile", blush: true },
};
