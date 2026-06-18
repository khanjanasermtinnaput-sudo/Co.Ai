import { cn } from "@/lib/utils";

interface LogoMarkProps {
  className?: string;
  size?: number;
}

/** Nexora geometric mark — hexagonal multi-agent network convergence symbol. */
export function LogoMark({ className, size = 32 }: LogoMarkProps) {
  const s = size;
  // Hex geometry: center (s/2, s/2), outer radius = s*0.41
  const cx = s / 2;
  const cy = s / 2;
  const r = s * 0.41;
  const rx = r * 0.5;       // cos60
  const ry = r * 0.866;     // sin60

  // 6 outer node positions
  const nodes = [
    { x: cx + r,   y: cy       },  // N1 right
    { x: cx + rx,  y: cy - ry  },  // N2 upper-right
    { x: cx - rx,  y: cy - ry  },  // N3 upper-left
    { x: cx - r,   y: cy       },  // N4 left
    { x: cx - rx,  y: cy + ry  },  // N5 lower-left
    { x: cx + rx,  y: cy + ry  },  // N6 lower-right
  ];

  const hex = nodes.map(n => `${n.x.toFixed(2)},${n.y.toFixed(2)}`).join(" ");
  const nodeColors = ["#06B6D4", "#06B6D4", "#22D3EE", "#818CF8", "#6366F1", "#4F46E5"];

  const id = `nm-${size}`;

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      fill="none"
      aria-label="Nexora"
      className={cn("shrink-0", className)}
    >
      <defs>
        <radialGradient id={`${id}-bg`} cx="40%" cy="35%" r="70%">
          <stop offset="0%"   stopColor="#1a1535"/>
          <stop offset="100%" stopColor="#0A0A0A"/>
        </radialGradient>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#06B6D4"/>
          <stop offset="50%"  stopColor="#6366F1"/>
          <stop offset="100%" stopColor="#4F46E5"/>
        </linearGradient>
        <radialGradient id={`${id}-c`} cx="40%" cy="36%" r="70%">
          <stop offset="0%"   stopColor="#FFFFFF"/>
          <stop offset="40%"  stopColor="#A5B4FC"/>
          <stop offset="100%" stopColor="#4F46E5"/>
        </radialGradient>
        <filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur in="SourceAlpha" stdDeviation={s * 0.045} result="blur"/>
          <feFlood floodColor="#6366F1" floodOpacity="0.55" result="fc"/>
          <feComposite in="fc" in2="blur" operator="in" result="glow"/>
          <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Dark rounded-square background */}
      <rect width={s} height={s} rx={s * 0.225} fill={`url(#${id}-bg)`}/>

      {/* Hexagonal ring */}
      <polygon
        points={hex}
        stroke={`url(#${id}-g)`}
        strokeWidth={Math.max(0.6, s * 0.025)}
        strokeOpacity="0.42"
        strokeLinejoin="round"
      />

      {/* Spokes to center */}
      {nodes.map((n, i) => (
        <line
          key={i}
          x1={n.x} y1={n.y}
          x2={cx}  y2={cy}
          stroke={`url(#${id}-g)`}
          strokeWidth={Math.max(0.6, s * 0.025)}
          strokeLinecap="round"
          strokeOpacity="0.52"
        />
      ))}

      {/* Outer nodes */}
      {nodes.map((n, i) => (
        <circle
          key={i}
          cx={n.x} cy={n.y}
          r={Math.max(1.2, s * 0.045)}
          fill={nodeColors[i]}
          opacity="0.85"
        />
      ))}

      {/* Center node with glow */}
      <circle
        cx={cx} cy={cy}
        r={s * 0.125}
        fill="none"
        stroke="#5B21B6"
        strokeWidth={s * 0.06}
        strokeOpacity="0.12"
      />
      <circle
        cx={cx} cy={cy}
        r={s * 0.12}
        fill={`url(#${id}-c)`}
        filter={`url(#${id}-glow)`}
      />
      {/* Specular highlight */}
      <circle
        cx={cx - s * 0.03} cy={cy - s * 0.03}
        r={s * 0.037}
        fill="white"
        opacity="0.46"
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
          <span className="text-gradient-gold">Nexora</span>
        </span>
      )}
    </span>
  );
}
