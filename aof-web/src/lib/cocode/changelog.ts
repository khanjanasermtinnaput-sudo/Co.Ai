// ── Changelog Generator (Phase 44) ───────────────────────────────────────────
// Parses conventional commit messages and generates structured changelogs.
// Supports Keep a Changelog and GitHub Releases formats.

export type CommitType =
  | "feat" | "fix" | "perf" | "refactor" | "docs"
  | "style" | "test" | "chore" | "ci" | "build" | "revert" | "other";

export interface ParsedCommit {
  hash: string;
  type: CommitType;
  scope: string | null;
  breaking: boolean;
  subject: string;
  body: string;
  author: string;
  date: string;
}

export interface ChangelogSection {
  type: CommitType;
  label: string;
  commits: ParsedCommit[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  breaking: ParsedCommit[];
  sections: ChangelogSection[];
}

// ── Commit type labels ────────────────────────────────────────────────────────

const TYPE_LABELS: Record<CommitType, string> = {
  feat: "Features",
  fix: "Bug Fixes",
  perf: "Performance Improvements",
  refactor: "Refactoring",
  docs: "Documentation",
  style: "Styles",
  test: "Tests",
  chore: "Chores",
  ci: "Continuous Integration",
  build: "Build System",
  revert: "Reverts",
  other: "Other Changes",
};

const TYPE_ORDER: CommitType[] = ["feat", "fix", "perf", "refactor", "docs", "style", "test", "chore", "ci", "build", "revert", "other"];

// ── Parser ────────────────────────────────────────────────────────────────────

export function parseConventionalCommit(line: string): ParsedCommit {
  // Format: <hash> <type>(<scope>)!: <subject>
  const parts = line.trim().split(" ");
  const hash = parts[0]?.slice(0, 7) ?? "unknown";
  const rest = parts.slice(1).join(" ");

  const conventionalRe = /^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(.+)/;
  const m = conventionalRe.exec(rest);

  if (!m) {
    return {
      hash, type: "other", scope: null, breaking: false,
      subject: rest, body: "", author: "", date: "",
    };
  }

  const rawType = m[1].toLowerCase();
  const validTypes: CommitType[] = ["feat", "fix", "perf", "refactor", "docs", "style", "test", "chore", "ci", "build", "revert"];
  const type: CommitType = validTypes.includes(rawType as CommitType) ? (rawType as CommitType) : "other";

  return {
    hash,
    type,
    scope: m[2] ?? null,
    breaking: m[3] === "!" || rest.toLowerCase().includes("breaking change"),
    subject: m[4].trim(),
    body: "",
    author: "",
    date: new Date().toISOString().split("T")[0],
  };
}

export function parseGitLog(log: string): ParsedCommit[] {
  return log.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => parseConventionalCommit(l));
}

// ── Changelog builder ─────────────────────────────────────────────────────────

export function buildChangelog(commits: ParsedCommit[], version: string): ChangelogRelease {
  const date = new Date().toISOString().split("T")[0];
  const breaking = commits.filter((c) => c.breaking);

  const grouped: Partial<Record<CommitType, ParsedCommit[]>> = {};
  for (const commit of commits) {
    if (!grouped[commit.type]) grouped[commit.type] = [];
    grouped[commit.type]!.push(commit);
  }

  const sections: ChangelogSection[] = TYPE_ORDER
    .filter((t) => grouped[t]?.length)
    .map((t) => ({ type: t, label: TYPE_LABELS[t], commits: grouped[t]! }));

  return { version, date, breaking, sections };
}

export function formatMarkdown(release: ChangelogRelease): string {
  const lines: string[] = [
    `## [${release.version}] — ${release.date}`,
    "",
  ];

  if (release.breaking.length > 0) {
    lines.push("### ⚠️ Breaking Changes", "");
    for (const c of release.breaking) {
      lines.push(`- **${c.scope ? `${c.scope}: ` : ""}${c.subject}** (\`${c.hash}\`)`);
    }
    lines.push("");
  }

  for (const section of release.sections) {
    lines.push(`### ${section.label}`, "");
    for (const c of section.commits) {
      const scope = c.scope ? `**${c.scope}:** ` : "";
      lines.push(`- ${scope}${c.subject} (\`${c.hash}\`)`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function buildAIChangelogPrompt(gitLog: string): string {
  return `You are a changelog writer. Given the following git log, generate a human-readable changelog in Keep a Changelog format.

Group changes into: Added, Changed, Deprecated, Removed, Fixed, Security.
Use clear, user-facing language. Omit trivial commits (WIP, typo, etc.).
Output ONLY the markdown changelog starting with "## [Unreleased]".

Git log:
${gitLog.slice(0, 3000)}`;
}
