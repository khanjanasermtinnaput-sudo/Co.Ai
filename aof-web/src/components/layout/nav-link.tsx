"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface NavLinkProps {
  href: string;
  label: string;
  icon: LucideIcon;
  expanded?: boolean;
  exact?: boolean;
  onNavigate?: () => void;
}

export function NavLink({
  href,
  label,
  icon: Icon,
  expanded = false,
  exact = false,
  onNavigate,
}: NavLinkProps) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const content = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center rounded-xl text-sidebar-foreground transition-colors",
        "hover:bg-foreground/[0.06] hover:text-foreground",
        active && "bg-foreground/[0.06] text-foreground",
        expanded ? "h-11 w-full gap-3 px-3" : "size-11 justify-center",
      )}
    >
      {/* active accent bar */}
      <span
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon
        className={cn(
          "size-[20px] shrink-0 transition-colors",
          active ? "text-primary" : "text-current",
        )}
      />
      {expanded && <span className="truncate text-sm font-medium">{label}</span>}
    </Link>
  );

  if (expanded) return content;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right" className="font-medium">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
