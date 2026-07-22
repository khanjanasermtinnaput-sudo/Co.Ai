"use client";

/**
 * TAOTAO beside the AI message — it *is* the assistant avatar, and reacts to
 * the message's state: thinking → writing (typing) → success (wink) → sad.
 * Only the latest message animates; older ones stay calm. No cards.
 */

import "./mascot.css";
import { useUIStore } from "@/store/ui-store";
import { TaotaoSprite } from "./taotao-sprite";
import { Sparkles } from "./effects";
import type { Emotion } from "./palette";
import type { ChatMessageT } from "@/lib/types";

export function TaotaoAvatar({
  message,
  isLast,
}: {
  message: ChatMessageT;
  isLast?: boolean;
}) {
  const animate = useUIStore((s) => s.mascotAnimations);
  let emotion: Emotion = "neutral";
  let alive = false;
  let success = false;

  if (message.error) {
    emotion = "sad";
  } else if (isLast && message.streaming) {
    emotion = message.content ? "coding" : "curious"; // writing vs. thinking
    alive = animate;
  } else if (isLast) {
    emotion = "success"; // answer complete — wink + smile
    alive = animate;
    success = animate;
  }

  return (
    <span
      className="relative flex size-8 items-center justify-center rounded-full border border-foreground/10 bg-card"
      data-mascot-animate={animate ? "on" : "off"}
    >
      {success && <Sparkles />}
      <TaotaoSprite emotion={emotion} size={26} alive={alive} />
    </span>
  );
}
