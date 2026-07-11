"use client";

import { Check, ChevronDown, Zap, Sparkles } from "lucide-react";
import { CHAT_MODELS } from "@/lib/constants";
import type { ChatModel, EffortLevel } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EffortPicker,
  MODEL_MENU_ITEM,
  MODEL_MENU_LABEL,
  MODEL_MENU_SEPARATOR,
  MODEL_MENU_SURFACE,
  ModelIconTile,
} from "@/components/ui/model-menu";

// Mikros = fast/lightweight, Kanon = balanced reasoning.
const ICON: Record<ChatModel, typeof Zap> = {
  lite: Zap,
  normal: Sparkles,
};

/** CoChat model picker. Mirrors CoCode's CodeModeSelector — same trigger style,
 *  same white card-deck menu — so both products feel consistent. Manual choice
 *  only; there is no Auto mode. */
export function ChatModelSelector({
  value,
  onChange,
  effort,
  onEffortChange,
}: {
  value: ChatModel;
  onChange: (model: ChatModel) => void;
  effort: EffortLevel;
  onEffortChange: (effort: EffortLevel) => void;
}) {
  const current = CHAT_MODELS.find((m) => m.id === value) ?? CHAT_MODELS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[15px] font-medium text-foreground transition-colors hover:bg-white/5"
        >
          <span className="font-semibold">CoChat</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-primary">{current.name}</span>
          <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={MODEL_MENU_SURFACE}>
        <DropdownMenuLabel className={MODEL_MENU_LABEL}>CoChat model</DropdownMenuLabel>
        <DropdownMenuSeparator className={MODEL_MENU_SEPARATOR} />
        {CHAT_MODELS.map((m) => {
          const active = m.id === value;
          return (
            <DropdownMenuItem
              key={m.id}
              onClick={() => onChange(m.id)}
              className={MODEL_MENU_ITEM}
            >
              <ModelIconTile icon={ICON[m.id]} />
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-neutral-900">{m.name}</span>
                  {m.badge && (
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-1.5 py-px text-[10px] font-medium text-neutral-600">
                      {m.badge}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">
                  {m.description}
                </span>
              </span>
              {active && <Check className="mt-1 size-4 !text-neutral-900" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className={MODEL_MENU_SEPARATOR} />
        <EffortPicker model={value} value={effort} onChange={onEffortChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
