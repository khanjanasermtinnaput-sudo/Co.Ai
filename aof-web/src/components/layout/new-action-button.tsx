"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function NewActionButton({
  expanded,
  label,
  onClick,
}: {
  expanded: boolean;
  label: string;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "group flex items-center rounded-xl bg-primary font-medium text-primary-foreground shadow-neo-sm transition-all hover:shadow-neo active:shadow-neo-inset active:scale-[0.98]",
        expanded ? "h-11 w-full gap-2 px-3 text-sm" : "size-11 justify-center",
      )}
    >
      <Plus className="size-[20px] shrink-0" />
      {expanded && <span>{label}</span>}
    </button>
  );

  if (expanded) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
