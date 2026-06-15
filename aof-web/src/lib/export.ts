// ── Conversation export helpers ───────────────────────────────────────────────
import type { Conversation } from "@/lib/types";

/** Format a conversation as clean Markdown. */
export function toMarkdown(conv: Conversation): string {
  const lines: string[] = [
    `# ${conv.title}`,
    ``,
    `> Exported from Aof · ${new Date(conv.createdAt).toLocaleString()}`,
    ``,
  ];

  for (const msg of conv.messages) {
    if (msg.role === "system") continue;
    const who = msg.role === "user" ? "**You**" : "**Aof**";
    const ts = new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    lines.push(`---`);
    lines.push(``);
    lines.push(`${who} · ${ts}`);
    lines.push(``);

    if (msg.attachments?.length) {
      for (const a of msg.attachments) {
        lines.push(`_📎 ${a.name} (${a.kind})_`);
      }
      lines.push(``);
    }

    if (msg.error) {
      lines.push(`> ⚠ Provider error: ${msg.error.code} — ${msg.error.problem}`);
    } else if (msg.content) {
      lines.push(msg.content);
    }

    lines.push(``);
  }

  return lines.join("\n");
}

/** Serialise conversation as structured JSON (omit raw binary data URLs). */
export function toJSON(conv: Conversation): string {
  const clean = {
    id: conv.id,
    title: conv.title,
    model: conv.model,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messages: conv.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model,
        route: m.route?.target,
        style: m.style,
        createdAt: m.createdAt,
        attachments: m.attachments?.map((a) => ({
          name: a.name,
          kind: a.kind,
          size: a.size,
          mime: a.mime,
        })),
      })),
  };
  return JSON.stringify(clean, null, 2);
}

/** Trigger a browser file download. */
export function downloadFile(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Slugify a title for use as a filename. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9฀-๿]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "chat";
}

export function exportConversation(conv: Conversation, format: "md" | "json"): void {
  const slug = slugify(conv.title);
  if (format === "md") {
    downloadFile(toMarkdown(conv), `${slug}.md`, "text/markdown");
  } else {
    downloadFile(toJSON(conv), `${slug}.json`, "application/json");
  }
}

/** Rough token estimate: ~4 chars per token (GPT family heuristic). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}
