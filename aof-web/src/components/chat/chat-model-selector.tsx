"use client";

import { Check, ChevronDown, Zap, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAT_MODELS } from "@/lib/constants";
import type { ChatModel } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

// Mikros = fast/lightweight, Kanon = balanced reasoning.
const ICON: Record<ChatModel, typeof Zap> = {
  lite: Zap,
  normal: Sparkles,
};

/** CoChat model picker. Mirrors CoCode's CodeModeSelector — same trigger style and
 *  header placement — so both products feel consistent. Manual choice only; there
 *  is no Auto mode. */
export function ChatModelSelector({
  value,
  onChange,
}: {
  value: ChatModel;
  onChange: (model: ChatModel) => void;
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
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>CoChat model</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {CHAT_MODELS.map((m) => {
          const Icon = ICON[m.id];
          const active = m.id === value;
          return (
            <DropdownMenuItem
              key={m.id}
              onClick={() => onChange(m.id)}
              className="items-start gap-3 py-2.5"
            >
              <span className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-primary/12 [&>svg]:text-primary">
                <Icon className="size-4" />
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{m.name}</span>
                  {m.badge && (
                    <Badge variant="muted" className="px-1.5 py-0 text-[10px]">
                      {m.badge}
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {m.description}
                </span>
              </span>
              {active && <Check className="mt-1 size-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
