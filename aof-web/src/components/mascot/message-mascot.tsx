"use client";

/**
 * TAOTAO beside the AI message — it *is* the assistant avatar, and reacts to
 * the message's state: thinking → writing (typing) → success (wink) → sad.
 * Only the latest message animates; older ones stay calm. No cards.
 */

import "./mascot.css";
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
  let emotion: Emotion = "neutral";
  let alive = false;
  let success = false;

  if (message.error) {
    emotion = "sad";
  } else if (isLast && message.streaming) {
    emotion = message.content ? "coding" : "curious"; // writing vs. thinking
    alive = true;
  } else if (isLast) {
    emotion = "success"; // answer complete — wink + smile
    alive = true;
    success = true;
  }

  return (
    <span className="relative flex size-8 items-center justify-center rounded-full border border-white/10 bg-card">
      {success && <Sparkles />}
      <TaotaoSprite emotion={emotion} size={26} alive={alive} />
    </span>
  );
}
