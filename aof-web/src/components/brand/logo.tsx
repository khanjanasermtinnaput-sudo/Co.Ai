import { cn } from "@/lib/utils";

interface LogoMarkProps {
  className?: string;
  size?: number;
}

/** The Aof mark — a rounded glyph with an orange-gold gradient "A" cut from it. */
export function LogoMark({ className, size = 32 }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="aof-g" x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FBBF24" />
          <stop offset="0.5" stopColor="#F59E0B" />
          <stop offset="1" stopColor="#EA7A0C" />
        </linearGradient>
      </defs>
      <rect
        x="2"
        y="2"
        width="36"
        height="36"
        rx="11"
        fill="url(#aof-g)"
        fillOpacity="0.16"
        stroke="url(#aof-g)"
        strokeOpacity="0.5"
        strokeWidth="1.4"
      />
      {/* Stylised "A" */}
      <path
        d="M13 28 L20 12 L27 28 M16.2 22.5 H23.8"
        stroke="url(#aof-g)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
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
          <span className="text-gradient-gold">Aof</span>
        </span>
      )}
    </span>
  );
}
