// ── Unified Diff Engine (Phase 7) ─────────────────────────────────────────────
// Parse unified git diffs produced by the AI and manage accept/reject state.
// Format: standard unified diff (--- a/file / +++ b/file / @@ hunks @@)

export type DiffLineKind = "context" | "added" | "removed" | "hunk-header" | "file-header";

export interface DiffLine {
  kind: DiffLineKind;
  content: string;   // raw line text without leading +/-/
  raw: string;       // full line as-is
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  id: string;
  header: string;           // e.g. "@@ -10,7 +10,8 @@"
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
  accepted: boolean | null; // null = pending, true = accepted, false = rejected
}

export interface FileDiff {
  id: string;
  oldPath: string;   // a/src/foo.ts  (without "a/")
  newPath: string;   // b/src/foo.ts  (without "b/")
  hunks: DiffHunk[];
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
}

export interface ParsedDiff {
  files: FileDiff[];
  raw: string;
}

// ── Parser ────────────────────────────────────────────────────────────────────

let _id = 0;
function uid() { return String(++_id); }

export function parseDiff(raw: string): ParsedDiff {
  const lines = raw.split("\n");
  const files: FileDiff[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      // New file block
      let oldPath = "";
      let newPath = "";
      let isNew = false;
      let isDeleted = false;
      const isBinary = false;

      // Consume diff/index/--- /+++ header lines
      while (i < lines.length && !lines[i].startsWith("@@")) {
        const l = lines[i];
        if (l.startsWith("--- ")) oldPath = l.slice(4).replace(/^a\//, "").trim();
        if (l.startsWith("+++ ")) newPath = l.slice(4).replace(/^b\//, "").trim();
        if (l === "--- /dev/null") isNew = true;
        if (l === "+++ /dev/null") isDeleted = true;
        i++;
      }

      const hunks: DiffHunk[] = [];

      // Parse hunks
      while (i < lines.length && lines[i].startsWith("@@")) {
        const hunkHeader = lines[i];
        const match = hunkHeader.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        const oldStart = match ? parseInt(match[1], 10) : 1;
        const newStart = match ? parseInt(match[2], 10) : 1;
        i++;

        const hunkLines: DiffLine[] = [];
        let oldLine = oldStart;
        let newLine = newStart;

        while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff ") && !lines[i].startsWith("--- ")) {
          const l = lines[i];
          if (l.startsWith("+")) {
            hunkLines.push({ kind: "added", content: l.slice(1), raw: l, newLine: newLine++ });
          } else if (l.startsWith("-")) {
            hunkLines.push({ kind: "removed", content: l.slice(1), raw: l, oldLine: oldLine++ });
          } else {
            const content = l.startsWith(" ") ? l.slice(1) : l;
            hunkLines.push({ kind: "context", content, raw: l, oldLine: oldLine++, newLine: newLine++ });
          }
          i++;
        }

        hunks.push({
          id: uid(),
          header: hunkHeader,
          oldStart,
          newStart,
          lines: hunkLines,
          accepted: null,
        });
      }

      if (oldPath || newPath) {
        files.push({
          id: uid(),
          oldPath: oldPath || newPath,
          newPath: newPath || oldPath,
          hunks,
          isNew,
          isDeleted,
          isBinary,
        });
      }
      continue;
    }

    i++;
  }

  return { files, raw };
}

// ── Extract diff from AI markdown output ─────────────────────────────────────
// AI often wraps diffs in ```diff ... ``` fences or outputs them inline.

export function extractDiffs(text: string): string[] {
  const fenced: string[] = [];
  const fenceRe = /```(?:diff|patch)?\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    const block = m[1].trim();
    if (block.includes("---") || block.includes("+++") || block.includes("@@")) {
      fenced.push(block);
    }
  }
  if (fenced.length) return fenced;

  // Fallback: find contiguous diff blocks in plain text
  const lines = text.split("\n");
  const blocks: string[] = [];
  let inBlock = false;
  let block: string[] = [];

  for (const line of lines) {
    if (!inBlock && (line.startsWith("--- ") || line.startsWith("diff --git"))) {
      inBlock = true;
      block = [line];
    } else if (inBlock) {
      block.push(line);
      // End block when we see two blank lines
      if (line === "" && block[block.length - 2] === "") {
        blocks.push(block.join("\n"));
        block = [];
        inBlock = false;
      }
    }
  }
  if (block.length) blocks.push(block.join("\n"));
  return blocks;
}

// ── Apply a single accepted hunk to file content ──────────────────────────────

export function applyHunk(content: string, hunk: DiffHunk): string {
  const lines = content.split("\n");
  const removals = new Set<number>();
  const insertions: Array<{ after: number; content: string }> = [];

  let oldIdx = hunk.oldStart - 1; // 0-indexed

  for (const line of hunk.lines) {
    if (line.kind === "removed") {
      removals.add(oldIdx++);
    } else if (line.kind === "added") {
      insertions.push({ after: oldIdx - 1, content: line.content });
    } else {
      oldIdx++;
    }
  }

  const result: string[] = [];
  let insMap = new Map<number, string[]>();
  for (const ins of insertions) {
    if (!insMap.has(ins.after)) insMap.set(ins.after, []);
    insMap.get(ins.after)!.push(ins.content);
  }

  for (let i = 0; i < lines.length; i++) {
    const preIns = insMap.get(i - 1);
    if (preIns) result.push(...preIns);
    if (!removals.has(i)) result.push(lines[i]);
  }

  // Insertions after last line
  const afterLast = insMap.get(lines.length - 1);
  if (afterLast) result.push(...afterLast);

  return result.join("\n");
}

export function applyAcceptedHunks(content: string, file: FileDiff): string {
  let result = content;
  for (const hunk of file.hunks) {
    if (hunk.accepted === true) {
      result = applyHunk(result, hunk);
    }
  }
  return result;
}

// ── Diff stats ────────────────────────────────────────────────────────────────

export interface DiffStats {
  added: number;
  removed: number;
  files: number;
}

export function diffStats(diff: ParsedDiff): DiffStats {
  let added = 0;
  let removed = 0;
  for (const file of diff.files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === "added") added++;
        if (line.kind === "removed") removed++;
      }
    }
  }
  return { added, removed, files: diff.files.length };
}
