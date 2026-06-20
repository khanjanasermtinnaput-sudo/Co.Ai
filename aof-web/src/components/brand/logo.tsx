import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoMarkProps {
  className?: string;
  size?: number;
}

/** The Coagentix mark — the code-loop emblem, rendered as a rounded app-style tile. */
export function LogoMark({ className, size = 32 }: LogoMarkProps) {
  return (
    <Image
      src="/aof-logo.png"
      alt="CoAgentix"
      width={size}
      height={size}
      className={cn("shrink-0 rounded-[22%] object-cover", className)}
    />
  );
}

interface LogoProps {
  showWordmark?: boolean;
  className?: string;
  size?: number;
}

export function Logo({ showWordmark = true, className, size = 32 }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      {showWordmark && (
        <span className="text-[17px] font-semibold tracking-tight">
          <span className="text-gradient-gold">CoAgentix</span>
        </span>
      )}
    </span>
  );
}
