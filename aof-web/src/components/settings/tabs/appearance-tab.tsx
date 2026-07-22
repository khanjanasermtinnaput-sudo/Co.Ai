"use client";

import { useTheme } from "next-themes";
import { Check, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMounted } from "@/hooks/use-mounted";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const current = mounted ? theme ?? "dark" : "dark";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>
            Monochrome by design — surfaces adapt, colour is kept for status only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <ThemeOption
              icon={Moon}
              label="Dark"
              active={current === "dark"}
              onClick={() => setTheme("dark")}
              preview="bg-[#131519]"
            />
            <ThemeOption
              icon={Sun}
              label="Light"
              active={current === "light"}
              onClick={() => setTheme("light")}
              preview="bg-[#e6e7ea]"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Palette</CardTitle>
          <CardDescription>Black &amp; white, with colour reserved for status.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <span className="size-9 rounded-full bg-primary shadow-neo-sm" />
          <div>
            <p className="text-sm font-medium">Monochrome</p>
            <p className="text-xs text-muted-foreground">Neomorphism + glass</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="size-3.5 rounded-full bg-success" title="Success" />
            <span className="size-3.5 rounded-full bg-warning" title="Warning" />
            <span className="size-3.5 rounded-full bg-destructive" title="Error" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <p className="text-sm font-medium">Reduced motion</p>
          <p className="text-xs text-muted-foreground">
            Co.AI follows your system&apos;s reduce-motion preference automatically —
            animations quiet down when your OS asks.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ThemeOption({
  icon: Icon,
  label,
  active,
  onClick,
  preview,
}: {
  icon: typeof Moon;
  label: string;
  active: boolean;
  onClick: () => void;
  preview: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3 text-left transition-all",
        active ? "border-primary/50 bg-primary/10 shadow-glow-sm" : "border-border hover:border-primary/30",
      )}
    >
      <span className={cn("flex size-10 items-center justify-center rounded-lg border border-foreground/10", preview)}>
        <Icon className="size-4 text-primary" />
      </span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      {active && <Check className="size-4 text-primary" />}
    </button>
  );
}
