"use client";

// Shows which Co.AI model tier produced this reply, e.g. "[Ypertatos 1.0]".
// Always derived from getModelDisplayName so a future version bump
// (Mikros 1.0 → Mikros 1.1) never requires touching this component.

import type { ChatModel, CodeMode } from "@/lib/types";
import { getModelDisplayName } from "@/lib/model-branding";
import { cn } from "@/lib/utils";

export function ModelBadge({
  model,
  className,
}: {
  model: ChatModel | CodeMode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary",
        className,
      )}
    >
      [{getModelDisplayName(model)}]
    </span>
  );
}
