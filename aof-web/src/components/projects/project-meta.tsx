import {
  Globe,
  Smartphone,
  Server,
  Gamepad2,
  Workflow,
  FlaskConical,
  type LucideIcon,
} from "lucide-react";
import type { ProjectStatus, ProjectType } from "@/lib/types";
import type { BadgeProps } from "@/components/ui/badge";

export const TYPE_META: Record<ProjectType, { label: string; icon: LucideIcon }> = {
  "web-app": { label: "Web App", icon: Globe },
  "mobile-app": { label: "Mobile App", icon: Smartphone },
  api: { label: "API", icon: Server },
  game: { label: "Game", icon: Gamepad2 },
  automation: { label: "Automation", icon: Workflow },
  research: { label: "Research", icon: FlaskConical },
};

export const STATUS_META: Record<
  ProjectStatus,
  { label: string; variant: BadgeProps["variant"] }
> = {
  active: { label: "Active", variant: "success" },
  building: { label: "Building", variant: "default" },
  review: { label: "In review", variant: "warning" },
  archived: { label: "Archived", variant: "muted" },
};
