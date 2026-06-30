// ── Smart Refactoring API (Phase 19) ─────────────────────────────────────────
// Server-side refactoring operations that require AI (extract, convert).
// Client handles non-AI operations (rename-symbol, move-file) directly.

import { classifyProviderError } from "@/lib/errors";

export const runtime = "nodejs";

interface RefactorRequest {
  kind: "rename-symbol" | "extract-component" | "extract-hook" | "extract-function"
      | "js-to-ts" | "css-to-tailwind" | "remove-dead-code";
  file: { path: string; content: string };
  selection?: { start: number; end: number; text: string };
  symbol?: { name: string; newName: string };
  allFiles?: Array<{ path: string; content: string }>;
}

export async function POST(req: Request): Promise<Response> {
  let body: RefactorRequest;
  try {
    body = (await req.json()) as RefactorRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { kind, file, selection, symbol, allFiles } = body;

  // ── Non-AI: rename-symbol ────────────────────────────────────────────────
  if (kind === "rename-symbol" && symbol) {
    const results = (allFiles ?? [file]).map((f) => ({
      path: f.path,
      content: f.content.replaceAll(
        new RegExp(`\\b${escapeRegex(symbol.name)}\\b`, "g"),
        symbol.newName,
      ),
    }));
    const changed = results.filter((r, i) =>
      r.content !== (allFiles ?? [file])[i].content,
    );
    return Response.json({
      diff: buildPseudoDiff(changed, allFiles ?? [file]),
      patchedFiles: changed,
    });
  }

  // ── AI-powered refactors ─────────────────────────────────────────────────
  // Route through /api/chat with a structured refactor prompt.
  const prompt = buildRefactorPrompt(kind, file, selection, allFiles);

  const chatRes = await fetch(
    new URL("/api/chat", req.url).toString(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: req.headers.get("Cookie") ?? "" },
      body: JSON.stringify({
        message: prompt,
        history: [],
        agent: "cocode",
        route: "refactor",
      }),
    },
  );

  if (!chatRes.ok) {
    const err = await chatRes.json().catch(() => ({ error: "provider failed" }));
    return Response.json(err, { status: chatRes.status });
  }

  // Stream the diff back
  return new Response(chatRes.body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function buildRefactorPrompt(
  kind: string,
  file: { path: string; content: string },
  selection?: { start: number; end: number; text: string },
  allFiles?: Array<{ path: string; content: string }>,
): string {
  const base = `You are an expert ${kind} refactor agent. Output ONLY a unified git diff. No explanation.`;

  const prompts: Record<string, string> = {
    "extract-component": `${base}
File: ${file.path}
\`\`\`
${file.content}
\`\`\`
Selected code to extract into a new React component:
\`\`\`
${selection?.text ?? "(selection not provided)"}
\`\`\`
Generate a unified diff that: 1) Creates a new component file, 2) Replaces the selection with the new component.`,

    "extract-hook": `${base}
File: ${file.path}
\`\`\`
${file.content}
\`\`\`
Extract stateful logic into a custom hook. Generate a unified diff.`,

    "extract-function": `${base}
File: ${file.path}
\`\`\`
${file.content}
\`\`\`
Selected code to extract:
\`\`\`
${selection?.text ?? ""}
\`\`\`
Generate a unified diff that extracts this into a named function.`,

    "js-to-ts": `${base}
Convert this file from JavaScript to TypeScript, adding proper types.
File: ${file.path}
\`\`\`
${file.content}
\`\`\``,

    "css-to-tailwind": `${base}
Convert CSS classes to Tailwind utility classes.
File: ${file.path}
\`\`\`
${file.content}
\`\`\``,

    "remove-dead-code": `${base}
Remove all unused imports, variables, and functions.
File: ${file.path}
\`\`\`
${file.content}
\`\`\``,
  };

  return prompts[kind] ?? `${base}\nRefactor kind: ${kind}\nFile: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPseudoDiff(
  changed: Array<{ path: string; content: string }>,
  original: Array<{ path: string; content: string }>,
): string {
  const origMap = new Map(original.map((f) => [f.path, f.content]));
  return changed
    .map((f) => {
      const orig = origMap.get(f.path) ?? "";
      const origLines = orig.split("\n");
      const newLines = f.content.split("\n");
      const header = `--- a/${f.path}\n+++ b/${f.path}`;
      const hunks: string[] = [];
      // simple line diff — show all changes
      for (let i = 0; i < Math.max(origLines.length, newLines.length); i++) {
        const o = origLines[i];
        const n = newLines[i];
        if (o !== n) {
          if (o !== undefined) hunks.push(`-${o}`);
          if (n !== undefined) hunks.push(`+${n}`);
        }
      }
      return hunks.length ? `${header}\n@@ -1,${origLines.length} +1,${newLines.length} @@\n${hunks.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}
