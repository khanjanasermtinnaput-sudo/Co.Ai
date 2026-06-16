/**
 * TAOTAO — pixel geometry helpers.
 *
 * Everything is generated on an integer grid so the result is genuinely
 * pixel-perfect at any scale. Shapes return de-duplicated integer coordinates;
 * the sprite renderer turns each coordinate into a 1×1 SVG <rect> with
 * shape-rendering="crispEdges" so it stays crisp on retina displays.
 */

export interface Px {
  x: number;
  y: number;
}

const key = (x: number, y: number) => `${x},${y}`;

/** Remove duplicate coordinates, preserving order. */
export function dedupe(pixels: Px[]): Px[] {
  const seen = new Set<string>();
  const out: Px[] = [];
  for (const p of pixels) {
    const k = key(p.x, p.y);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Filled axis-aligned rectangle. */
export function rect(x0: number, y0: number, w: number, h: number): Px[] {
  const out: Px[] = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) out.push({ x, y });
  }
  return out;
}

/** Filled ellipse centered at (cx, cy) with radii rx, ry. */
export function ellipse(cx: number, cy: number, rx: number, ry: number): Px[] {
  const out: Px[] = [];
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / (rx + 0.5);
      const dy = (y + 0.5 - cy) / (ry + 0.5);
      if (dx * dx + dy * dy <= 1) out.push({ x, y });
    }
  }
  return out;
}

export const circle = (cx: number, cy: number, r: number): Px[] =>
  ellipse(cx, cy, r, r);

/**
 * Filled triangle from three vertices (used for ears). Simple scanline test
 * via barycentric sign checks on the pixel center.
 */
export function triangle(a: Px, b: Px, c: Px): Px[] {
  const minX = Math.floor(Math.min(a.x, b.x, c.x));
  const maxX = Math.ceil(Math.max(a.x, b.x, c.x));
  const minY = Math.floor(Math.min(a.y, b.y, c.y));
  const maxY = Math.ceil(Math.max(a.y, b.y, c.y));
  const sign = (p1: Px, p2: Px, px: number, py: number) =>
    (px - p2.x) * (p1.y - p2.y) - (p1.x - p2.x) * (py - p2.y);
  const out: Px[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d1 = sign(a, b, px, py);
      const d2 = sign(b, c, px, py);
      const d3 = sign(c, a, px, py);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) out.push({ x, y });
    }
  }
  return out;
}

/** Union of pixel sets (de-duplicated). */
export const union = (...sets: Px[][]): Px[] => dedupe(sets.flat());

/**
 * 1px dark outline around a filled silhouette: every empty cell that is
 * 4-connected to a filled cell. Gives sprites the classic "inked" pixel edge.
 */
export function outline(pixels: Px[]): Px[] {
  const filled = new Set(pixels.map((p) => key(p.x, p.y)));
  const out: Px[] = [];
  const seen = new Set<string>();
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const p of pixels) {
    for (const [dx, dy] of neighbors) {
      const x = p.x + dx;
      const y = p.y + dy;
      const k = key(x, y);
      if (filled.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push({ x, y });
    }
  }
  return out;
}

/** Subtract `b` from `a`. */
export function subtract(a: Px[], b: Px[]): Px[] {
  const remove = new Set(b.map((p) => key(p.x, p.y)));
  return a.filter((p) => !remove.has(key(p.x, p.y)));
}

/** Keep only pixels of `a` that are inside `mask`. */
export function intersect(a: Px[], mask: Px[]): Px[] {
  const keep = new Set(mask.map((p) => key(p.x, p.y)));
  return a.filter((p) => keep.has(key(p.x, p.y)));
}
