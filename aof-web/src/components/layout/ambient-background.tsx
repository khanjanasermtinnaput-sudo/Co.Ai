/** Fixed, non-interactive backdrop. A flat canvas fill only — no gradients,
 *  glow, or drifting particles competing with content. */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <div className="absolute inset-0 bg-background" />
    </div>
  );
}
