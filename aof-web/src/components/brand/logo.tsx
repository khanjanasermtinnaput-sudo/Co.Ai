import { cn } from "@/lib/utils";

interface LogoMarkProps {
  className?: string;
  size?: number;
}

/** The Co.AI mark — three-node network emblem */
export function LogoMark({ className, size = 32 }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <rect width="24" height="24" rx="6" fill="#000000" />
      <circle cx="8.5" cy="12" r="2.4" fill="#ffffff" />
      <circle cx="15.5" cy="8.5" r="2.1" fill="#FF6A00" />
      <circle cx="15.5" cy="15.5" r="2.1" fill="#ffffff" />
      <path
        d="M10.6 11l3-2M10.6 13l3 2"
        stroke="#ffffff"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
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
          <span className="text-gradient-gold">Co.AI</span>
        </span>
      )}
    </span>
  );
}
