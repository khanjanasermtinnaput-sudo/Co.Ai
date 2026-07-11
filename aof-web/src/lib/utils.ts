import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names and de-dupe conflicting Tailwind classes. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Stable id for client-side records (conversations, projects, messages). */
export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

/** Human-friendly relative time, e.g. "2h ago", "just now". */
export function timeAgo(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (Number.isNaN(seconds)) return "";
  if (seconds < 45) return "just now";
  const units: [number, string][] = [
    [60, "min"],
    [60, "hour"],
    [24, "day"],
    [7, "week"],
    [4.34524, "month"],
    [12, "year"],
  ];
  let value = seconds / 60;
  let unit = "min";
  let acc = 60;
  for (const [factor, name] of units) {
    if (Math.abs(seconds) < acc) break;
    acc *= factor;
    value = seconds / (acc / 60);
    unit = name;
  }
  const rounded = Math.round(value);
  return `${rounded} ${unit}${rounded === 1 ? "" : "s"} ago`;
}

/** Clamp a number between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Black or white, whichever reads better on the given hex background color. */
export function readableTextColor(hex: string): "#000000" | "#ffffff" {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return "#ffffff";
  const int = parseInt(match[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  // Relative luminance (WCAG), sRGB channels linearized.
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  return luminance > 0.55 ? "#000000" : "#ffffff";
}
