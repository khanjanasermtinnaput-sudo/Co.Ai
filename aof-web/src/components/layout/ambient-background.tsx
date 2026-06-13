/** Fixed, non-interactive ambient backdrop: warm radial glow + faint aurora.
 *  Purely decorative — sits behind all content. */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      {/* top warm glow */}
      <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,hsl(38_92%_50%/0.16),transparent_62%)] blur-2xl" />
      {/* drifting aurora blobs */}
      <div className="absolute -left-32 top-1/3 h-[420px] w-[420px] animate-aurora-shift rounded-full bg-[radial-gradient(circle_at_center,hsl(28_92%_52%/0.10),transparent_60%)] blur-3xl" />
      <div className="absolute -right-24 top-1/4 h-[360px] w-[360px] animate-aurora-shift rounded-full bg-[radial-gradient(circle_at_center,hsl(45_96%_60%/0.08),transparent_60%)] blur-3xl [animation-delay:-6s]" />
      {/* subtle vignette to seat content */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,hsl(0_0%_0%/0.55))]" />
    </div>
  );
}
