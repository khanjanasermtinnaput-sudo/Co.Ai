"use client";

/**
 * TAOTAO — the in-chat companion that lives ON the chat input box.
 *
 * Wrap the composer with it:
 *   <ComposerMascot state={mascotState}><Composer …/></ComposerMascot>
 *
 * The cat(s) sit on the top border of the input box and never cover the text
 * field. No cards, no panels, no status screens — just TAOTAO and the chat.
 */

import { useEffect, useState } from "react";
import "./mascot.css";
import { TaotaoSprite } from "./taotao-sprite";
import type { Emotion } from "./palette";
import { CardboardBox, FoodBowl, Sparkles, Tears, YarnBall, Zzz } from "./effects";

export type ComposerMascotState = "waiting" | "processing" | "error" | "quota";

/** Idle scenes cycle gently while waiting for input (spec: yarn / sleep / box). */
type Scene = { emotion: Emotion; prop?: "yarn" | "sleep" | "box" };
const SCENES: Scene[] = [
  { emotion: "happy" },
  { emotion: "curious", prop: "yarn" },
  { emotion: "sleepy", prop: "sleep" },
  { emotion: "neutral", prop: "box" },
];

function useCycle(length: number, ms: number, active: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active || length <= 1) return;
    const id = setInterval(() => setI((v) => (v + 1) % length), ms);
    return () => clearInterval(id);
  }, [length, ms, active]);
  return active ? i : 0;
}

const CAT = 46; // companion size on the input box

function Waiting() {
  const idx = useCycle(SCENES.length, 4200, true);
  const scene = SCENES[idx];
  return (
    <div className="flex justify-center">
      <span className="tao-bob relative translate-y-[7px]" style={{ lineHeight: 0 }}>
        {scene.prop === "sleep" && <Zzz />}
        {scene.prop === "box" && (
          <span className="absolute inset-x-0 bottom-0 z-0 flex justify-center">
            <CardboardBox size={CAT * 1.05} />
          </span>
        )}
        <span className="relative z-[1]">
          <TaotaoSprite emotion={scene.emotion} size={CAT} />
        </span>
        {scene.prop === "yarn" && (
          <span className="absolute -right-2 bottom-0 z-[2]">
            <YarnBall size={CAT * 0.32} />
          </span>
        )}
      </span>
    </div>
  );
}

function Processing() {
  return (
    <div className="relative flex items-end justify-between px-3">
      <span className="translate-y-[7px]">
        <TaotaoSprite emotion="curious" size={CAT - 2} />
      </span>
      <span className="tao-yarn-cross" style={{ bottom: "55%" }}>
        <YarnBall size={CAT * 0.3} />
      </span>
      <span className="translate-y-[7px] -scale-x-100">
        <TaotaoSprite emotion="curious" size={CAT - 2} />
      </span>
    </div>
  );
}

function Sad({ quota }: { quota?: boolean }) {
  return (
    <div className="flex justify-center">
      <span className="tao-sad relative translate-y-[7px]" style={{ lineHeight: 0 }}>
        <Tears sides={quota ? "left" : "both"} />
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
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 bottom-full z-30">
        {state === "waiting" && <Waiting />}
        {state === "processing" && <Processing />}
        {state === "error" && <Sad />}
        {state === "quota" && <Sad quota />}
      </div>
      {children}
    </div>
  );
}
