"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Wand2, Zap, Sparkles } from "lucide-react";
import { CHAT_MODELS, type ChatModelSelectorId } from "@/lib/constants";
import { getModelDisplayName } from "@/lib/model-branding";
import { effortIntentsFor, type EffortIntent } from "@/lib/effort";
import type { ChatModel, EffortLevel } from "@/lib/types";
import { useUIStore } from "@/store/ui-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MODEL_MENU_BADGE,
  MODEL_MENU_CHECK,
  MODEL_MENU_DESC,
  MODEL_MENU_ITEM,
  MODEL_MENU_LABEL,
  MODEL_MENU_SEPARATOR,
  MODEL_MENU_SURFACE,
  MODEL_MENU_TITLE,
  ModelIconTile,
  IntentEffortChips,
  EffortSlider,
} from "@/components/ui/model-menu";

// Mikros = fast/lightweight, Kanon = balanced reasoning, Auto picks per-message.
const ICON: Record<ChatModelSelectorId, typeof Zap> = {
  auto: Wand2,
  lite: Zap,
  normal: Sparkles,
};

/** CoChat model picker. Mirrors CoCode's CodeModeSelector — same trigger style,
 *  same theme-aware card menu — so both products feel consistent. Auto sits on
 *  top and resolves per message (chat-store); a manual pick opts out of Auto
 *  for this conversation until switched back. */
export function ChatModelSelector({
  value,
  preference,
  onChange,
  onAuto,
  effortIntent,
  onEffortIntentChange,
  rawEffort,
  onRawEffortChange,
}: {
  /** Concrete tier the LAST turn actually used — what the trigger displays. */
  value: ChatModel;
  preference: ChatModel | "auto";
  onChange: (model: ChatModel) => void;
  onAuto: () => void;
  effortIntent: EffortIntent;
  onEffortIntentChange: (intent: EffortIntent) => void;
  /** Raw EffortLevel + setter — surfaced only in Developer Mode, as an
   *  "Advanced" expander, so no real level on the scale becomes unreachable
   *  behind the simplified intent chips. */
  rawEffort: EffortLevel;
  onRawEffortChange: (effort: EffortLevel) => void;
}) {
  const developerMode = useUIStore((s) => s.developerMode);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isAuto = preference === "auto";
  const triggerLabel = isAuto ? `Auto (${getModelDisplayName(value)})` : getModelDisplayName(value);
  const intents = effortIntentsFor(value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-body-lg font-medium text-foreground transition-colors hover:bg-foreground/5"
        >
          <span className="min-w-0 truncate">
            <span className="font-semibold">CoChat</span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-primary">{triggerLabel}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={MODEL_MENU_SURFACE}>
        <DropdownMenuLabel className={MODEL_MENU_LABEL}>CoChat model</DropdownMenuLabel>
        <DropdownMenuSeparator className={MODEL_MENU_SEPARATOR} />
        {CHAT_MODELS.map((m) => {
          const active = m.id === "auto" ? isAuto : !isAuto && m.id === value;
          return (
            <DropdownMenuItem
              key={m.id}
              onClick={() => (m.id === "auto" ? onAuto() : onChange(m.id as ChatModel))}
              className={MODEL_MENU_ITEM}
            >
              <ModelIconTile icon={ICON[m.id]} />
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span className={MODEL_MENU_TITLE}>{m.name}</span>
                  {m.badge && <span className={MODEL_MENU_BADGE}>{m.badge}</span>}
                </span>
                <span className={MODEL_MENU_DESC}>{m.description}</span>
              </span>
              {active && <Check className={MODEL_MENU_CHECK} />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className={MODEL_MENU_SEPARATOR} />
        <IntentEffortChips
          intents={intents}
          value={effortIntent}
          onChange={onEffortIntentChange}
        />
        {developerMode && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setShowAdvanced((v) => !v);
              }}
              className="flex w-full items-center gap-1.5 px-2 pb-1 pt-1.5 text-caption font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {showAdvanced ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              Advanced: raw effort level
            </button>
            {showAdvanced && <EffortSlider model={value} value={rawEffort} onChange={onRawEffortChange} />}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
