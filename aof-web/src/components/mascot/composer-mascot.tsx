"use client";

/**
 * TAOTAO — the in-chat companion that lives ON the chat input box.
 *
 * Wrap the composer with it:
 *   <ComposerMascot state={mascotState}><Composer …/></ComposerMascot>
 *
 * The cat(s) sit on the top border of the input box and never cover the text
 * field. No cards, no panels, no status screens — just TAOTAO and the chat.
 *
 * Calm by default: idle shows one static resting pose — no scene-cycling
 * timer. TaoTao only animates on real state changes (processing, error,
 * quota) or when explicitly turned on via Settings → Appearance; OS
 * prefers-reduced-motion always wins regardless of that setting.
 */

import "./mascot.css";
import { useUIStore } from "@/store/ui-store";
import { TaotaoSprite } from "./taotao-sprite";
import { FoodBowl, Tears, YarnBall } from "./effects";

export type ComposerMascotState = "waiting" | "processing" | "error" | "quota";

const CAT = 46; // companion size on the input box

function Waiting({ animate }: { animate: boolean }) {
  return (
    <div className="flex justify-center">
      <span className={animate ? "tao-bob relative translate-y-[7px]" : "relative translate-y-[7px]"} style={{ lineHeight: 0 }}>
        <TaotaoSprite emotion="happy" size={CAT} alive={animate} />
      </span>
    </div>
  );
}

function Processing({ animate }: { animate: boolean }) {
  return (
    <div className="relative flex items-end justify-between px-3">
      <span className="translate-y-[7px]">
        <TaotaoSprite emotion="curious" size={CAT - 2} alive={animate} />
      </span>
      {animate && (
        <span className="tao-yarn-cross" style={{ bottom: "55%" }}>
          <YarnBall size={CAT * 0.3} />
        </span>
      )}
      <span className="translate-y-[7px] -scale-x-100">
        <TaotaoSprite emotion="curious" size={CAT - 2} alive={animate} />
      </span>
    </div>
  );
}

function Sad({ quota, animate }: { quota?: boolean; animate: boolean }) {
  return (
    <div className="flex justify-center">
      <span className={animate ? "tao-sad relative translate-y-[7px]" : "relative translate-y-[7px]"} style={{ lineHeight: 0 }}>
        {animate && <Tears sides={quota ? "left" : "both"} />}
        <TaotaoSprite emotion="sad" size={CAT} alive={false} />
        {quota && (
          <span className="absolute -right-5 bottom-0 z-[2]">
            <FoodBowl size={CAT * 0.6} />
          </span>
        )}
      </span>
    </div>
  );
}

export function ComposerMascot({
  state,
  children,
}: {
  state: ComposerMascotState;
  children: React.ReactNode;
}) {
  const animate = useUIStore((s) => s.mascotAnimations);

  return (
    <div className="relative" data-mascot-animate={animate ? "on" : "off"}>
      <div className="pointer-events-none absolute inset-x-0 bottom-full z-30">
        {state === "waiting" && <Waiting animate={animate} />}
        {state === "processing" && <Processing animate={animate} />}
        {state === "error" && <Sad animate={animate} />}
        {state === "quota" && <Sad quota animate={animate} />}
      </div>
      {children}
    </div>
  );
}
