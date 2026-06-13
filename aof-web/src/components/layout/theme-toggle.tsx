"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useMounted } from "@/hooks/use-mounted";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ThemeToggle({
  expanded = false,
  className,
}: {
  expanded?: boolean;
  className?: string;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const isDark = resolvedTheme === "dark";

  const toggle = () => setTheme(isDark ? "light" : "dark");

  const button = (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className={cn(
        "group flex items-center gap-3 rounded-lg text-sidebar-foreground transition-colors hover:bg-white/5 hover:text-foreground",
        expanded ? "h-10 w-full px-3" : "size-10 justify-center",
        className,
      )}
    >
      <span className="relative inline-flex size-5 items-center justify-center">
        {mounted && isDark ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
      </span>
      {expanded && (
        <span className="text-sm font-medium">{isDark ? "Dark" : "Light"} theme</span>
      )}
    </button>
  );

  if (expanded) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">Toggle theme</TooltipContent>
    </Tooltip>
  );
}
