// ── Coagentix Image Memory — browser-side localStorage layer ─────────────────
// Step 7 & 9 of the image understanding workflow.
// Persists pipeline results locally so future messages are answered without
// re-reading the image. Mirrors the server-side image_memories table schema.

const STORAGE_KEY = "coagentix_image_memory";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (matches server)

export interface LocalImageMemory {
  id: string;
  imageHash: string;
  shortSummary: string;
  detailedSummary: string;
  reusableContext: string;
  ocrText: string;
  entities: string[];
  keyPoints: string[];
  scene: string;
  createdAt: string;
  expiresAt: string;
}

// ── Persistence ────────────────────────────────────────────────────────────────

function isExpired(m: LocalImageMemory): boolean {
  return Boolean(m.expiresAt) && Date.parse(m.expiresAt) < Date.now();
}

/** Load all non-expired memories from localStorage, keyed by imageHash. */
export function loadLocalImageMemories(): Map<string, LocalImageMemory> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, LocalImageMemory>;
    const map = new Map<string, LocalImageMemory>();
    for (const [hash, mem] of Object.entries(obj)) {
      if (!isExpired(mem)) map.set(hash, mem);
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Persist a single memory record to localStorage (upsert by imageHash). */
export function saveLocalImageMemory(mem: LocalImageMemory): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadLocalImageMemories();
    existing.set(mem.imageHash, mem);
    // Trim to most recent 100 entries (protect against unbounded growth)
    const sorted = [...existing.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt)
    );
    const trimmed: Record<string, LocalImageMemory> = {};
    for (const m of sorted.slice(0, 100)) trimmed[m.imageHash] = m;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

/** Check if an image (by hash) has already been analysed; return cached memory. */
export function findLocalByHash(imageHash: string): LocalImageMemory | undefined {
  if (typeof window === "undefined") return undefined;
  return loadLocalImageMemories().get(imageHash);
}

/** Remove all image memories from localStorage. */
export function clearLocalImageMemories(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

// ── Retrieval / search ─────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "what", "how", "why",
  "are", "was", "has", "can", "does", "image", "picture", "photo", "รูป", "ภาพ",
]);

function tokenize(s: string): string[] {
  return (s || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9฀-๿一-鿿぀-ヿ가-힯]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface RankedLocalMemory {
  memory: LocalImageMemory;
  score: number;
}

/** Rank stored memories by relevance to a user query (token overlap + recency). */
export function searchLocalImageMemories(query: string, k = 3): RankedLocalMemory[] {
  const qTerms = new Set(tokenize(query));
  if (!qTerms.size) return [];

  const memories = loadLocalImageMemories();
  const ranked: RankedLocalMemory[] = [];

  for (const mem of memories.values()) {
    const hay = [
      mem.shortSummary,
      mem.detailedSummary,
      mem.ocrText,
      mem.scene,
      mem.entities.join(" "),
      mem.keyPoints.join(" "),
    ].join(" ");

    const docSet = new Set(tokenize(hay));
    let overlap = 0;
    for (const t of qTerms) if (docSet.has(t)) overlap++;
    if (!overlap) continue;

    const ageDays = (Date.now() - Date.parse(mem.createdAt)) / 86_400_000;
    const score = overlap + Math.max(0, 0.5 - ageDays / 60);
    ranked.push({ memory: mem, score: Math.round(score * 1000) / 1000 });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, k);
}

// ── Context builder (Step 10) ─────────────────────────────────────────────────

/** Build a prompt-ready context block from ranked memories for injection. */
export function buildImageContext(ranked: RankedLocalMemory[]): string {
  if (!ranked.length) return "";
  const lines = [
    "## Image Memory (from images you uploaded earlier — answer from this context without re-reading the images)",
  ];
  for (const { memory } of ranked) {
    lines.push(`- ${memory.shortSummary || memory.detailedSummary.slice(0, 120)}`);
    if (memory.reusableContext) {
      lines.push(`  ${memory.reusableContext.replace(/\n+/g, " ").slice(0, 600)}`);
    }
  }
  return lines.join("\n");
}

/** Convenience: search + build context in one call. Returns empty string if nothing relevant. */
export function getImageContextForQuery(query: string, k = 3): string {
  const ranked = searchLocalImageMemories(query, k);
  return buildImageContext(ranked);
}
