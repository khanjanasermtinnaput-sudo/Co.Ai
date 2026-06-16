/**
 * TAOTAO — the official Aof AI pixel mascot.
 *
 * Public API:
 *   import { Taotao } from "@/components/mascot";
 *   <Taotao state="thinking" size={96} showStatus />
 *
 * Lower-level building blocks (sprite, palette, effects) are exported for custom
 * scenes and the micro-interactions documented in README.md.
 */

export { Taotao, type TaotaoProps, type TaotaoState } from "./taotao";
export { TaotaoSprite, type TaotaoSpriteProps } from "./taotao-sprite";
export {
  EMOTIONS,
  PALETTE,
  type Emotion,
  type Expression,
} from "./palette";
export {
  YarnBall,
  Laptop,
  CardboardBox,
  FoodBowl,
  EngineerHelmet,
  Rocket,
  Particles,
  Zzz,
  Tears,
} from "./effects";
