/**
 * TAOTAO — the official Co.AI pixel mascot, living inside the chat.
 *
 *   <ComposerMascot state="processing"><Composer …/></ComposerMascot>  // on the input box
 *   <TaotaoAvatar message={m} isLast />                                 // beside the AI message
 *
 * Asset-free, pixel-perfect, GPU-accelerated, SSR-safe. No panels or cards —
 * just the chat, the input box, and TAOTAO.
 */

export { ComposerMascot, type ComposerMascotState } from "./composer-mascot";
export { TaotaoAvatar } from "./message-mascot";
export { TaotaoSprite, type TaotaoSpriteProps } from "./taotao-sprite";
export {
  EMOTIONS,
  PALETTE,
  type Emotion,
  type Expression,
} from "./palette";
export { YarnBall, CardboardBox, FoodBowl, Zzz, Tears, Sparkles } from "./effects";
