/** Fixed, non-interactive ambient backdrop. Purely decorative — sits behind
 *  all content, never competes with it. Every animated layer rides the
 *  design system's global prefers-reduced-motion rule (globals.css), so it
 *  quiets down automatically for users who ask for less motion.
 *  Light mode: a barely-there cool highlight — quiet parity with dark mode,
 *  not the stark blank canvas it used to be.
 *  Dark mode: a faint, low-intensity warm glow + a few barely-perceptible
 *  drifting particles. */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* base canvas — pure white (light) / true black (dark) */}
      <div className="absolute inset-0 bg-background" />

      {/* Light mode: one quiet, static highlight — no motion, no particles */}
      <div className="absolute -top-44 left-1/2 h-[480px] w-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,hsl(220_14%_20%/0.025),transparent_64%)] blur-3xl dark:hidden" />

      {/* Warm ambient glow — dark mode only, ~80% softer than before */}
      <div className="absolute -top-44 left-1/2 hidden h-[480px] w-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,hsl(32_94%_44%/0.05),transparent_64%)] blur-3xl dark:block" />
      <div className="absolute -left-32 top-1/3 hidden h-[380px] w-[380px] animate-aurora-shift rounded-full bg-[radial-gradient(circle_at_center,hsl(28_90%_46%/0.03),transparent_62%)] blur-3xl dark:block" />
      <div className="absolute -right-24 top-1/4 hidden h-[340px] w-[340px] animate-aurora-shift rounded-full bg-[radial-gradient(circle_at_center,hsl(38_92%_50%/0.025),transparent_62%)] blur-3xl [animation-delay:-6s] dark:block" />

      {/* Barely-noticeable drifting particles — dark mode only */}
      <div className="absolute left-[18%] top-[28%] hidden size-1 rounded-full bg-primary/40 animate-drift-slow dark:block" />
      <div className="absolute left-[72%] top-[22%] hidden size-1 rounded-full bg-primary/30 animate-drift-slow [animation-delay:-4s] dark:block" />
      <div className="absolute left-[40%] top-[64%] hidden size-[3px] rounded-full bg-primary/25 animate-drift-slow [animation-delay:-9s] dark:block" />
      <div className="absolute left-[86%] top-[58%] hidden size-1 rounded-full bg-foreground/15 animate-drift-slow [animation-delay:-7s] dark:block" />

      {/* Very subtle vignette to seat content — dark mode only, much lighter */}
      <div className="absolute inset-0 hidden bg-[radial-gradient(ellipse_at_center,transparent_62%,hsl(0_0%_0%/0.30))] dark:block" />
    </div>
  );
}
