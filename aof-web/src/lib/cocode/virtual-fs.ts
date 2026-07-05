// ── Virtual File System ───────────────────────────────────────────────────────
// In-memory tree that represents the current project. Populated from GitHub API,
// AI-generated code, or local file uploads. All CoCode workspace operations
// (editor, diff, apply, refactor) read from and write to this FS.

export type FileLanguage =
  | "typescript" | "javascript" | "tsx" | "jsx"
  | "css" | "scss" | "html" | "json" | "markdown"
  | "python" | "rust" | "go" | "java" | "c" | "cpp"
  | "yaml" | "toml" | "sql" | "shell" | "plaintext";

export interface VirtualFile {
  path: string;       // full path from repo root, e.g. "src/app/page.tsx"
  name: string;       // basename, e.g. "page.tsx"
  content: string;
  language: FileLanguage;
  size: number;       // bytes (content.length)
  sha?: string;       // GitHub blob SHA for tracked files
  dirty: boolean;     // modified since last save/commit
  createdAt: number;  // epoch ms
  updatedAt: number;
}

export interface VirtualDir {
  path: string;
  name: string;
  children: (VirtualFile | VirtualDir)[];
  expanded: boolean;
}

export type VirtualNode = VirtualFile | VirtualDir;

export function isFile(node: VirtualNode): node is VirtualFile {
  return "content" in node;
}

export function isDir(node: VirtualNode): node is VirtualDir {
  return "children" in node;
}

// ── Language detection ────────────────────────────────────────────────────────
const EXT_MAP: Record<string, FileLanguage> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  css: "css", scss: "scss", html: "html", json: "json",
  md: "markdown", mdx: "markdown", py: "python",
  rs: "rust", go: "go", java: "java",
  c: "c", cpp: "cpp", cc: "cpp", h: "c",
  yaml: "yaml", yml: "yaml", toml: "toml",
  sql: "sql", sh: "shell", bash: "shell",
};

export function detectLanguage(filename: string): FileLanguage {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? "plaintext";
}

// ── Tree operations ───────────────────────────────────────────────────────────

export function buildTree(files: Array<{ path: string; content: string; sha?: string }>): VirtualDir {
  const root: VirtualDir = { path: "", name: "/", children: [], expanded: true };

  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const dirPath = parts.slice(0, i + 1).join("/");
      let dir = cur.children.find((c) => isDir(c) && c.name === part) as VirtualDir | undefined;
      if (!dir) {
        dir = { path: dirPath, name: part, children: [], expanded: false };
        cur.children.push(dir);
      }
      cur = dir;
    }

    const name = parts[parts.length - 1];
    const now = Date.now();
    const file: VirtualFile = {
      path: f.path,
      name,
      content: f.content,
      language: detectLanguage(name),
      size: f.content.length,
      sha: f.sha,
      dirty: false,
      createdAt: now,
      updatedAt: now,
    };
    cur.children.push(file);
  }

  sortTree(root);
  return root;
}

function sortTree(dir: VirtualDir): void {
  dir.children.sort((a, b) => {
    // Dirs before files, then alphabetical
    if (isDir(a) && !isDir(b)) return -1;
    if (!isDir(a) && isDir(b)) return 1;
    return a.name.localeCompare(b.name);
  });
  dir.children.filter(isDir).forEach((d) => sortTree(d as VirtualDir));
}

export function flattenFiles(dir: VirtualDir): VirtualFile[] {
  const files: VirtualFile[] = [];
  function walk(node: VirtualNode) {
    if (isFile(node)) files.push(node);
    else node.children.forEach(walk);
  }
  walk(dir);
  return files;
}

export function findFile(root: VirtualDir, path: string): VirtualFile | null {
  const files = flattenFiles(root);
  return files.find((f) => f.path === path) ?? null;
}

export function upsertFile(
  root: VirtualDir,
  path: string,
  content: string,
  sha?: string,
): VirtualDir {
  const next = structuredClone(root);
  const existing = findFile(next, path);

  if (existing) {
    existing.content = content;
    existing.size = content.length;
    existing.dirty = true;
    existing.updatedAt = Date.now();
    if (sha) existing.sha = sha;
    return next;
  }

  // Create new file — rebuild tree with it merged in
  const allFiles = flattenFiles(next);
  allFiles.push({
    path,
    name: path.split("/").pop() ?? path,
    content,
    language: detectLanguage(path.split("/").pop() ?? ""),
    size: content.length,
    sha,
    dirty: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return buildTree(allFiles.map((f) => ({ path: f.path, content: f.content, sha: f.sha })));
}

export function deleteFile(root: VirtualDir, path: string): VirtualDir {
  const files = flattenFiles(root).filter((f) => f.path !== path);
  return buildTree(files.map((f) => ({ path: f.path, content: f.content, sha: f.sha })));
}

export function renameFile(root: VirtualDir, oldPath: string, newPath: string): VirtualDir {
  const files = flattenFiles(root).map((f) =>
    f.path === oldPath
      ? { path: newPath, content: f.content, sha: f.sha }
      : { path: f.path, content: f.content, sha: f.sha },
  );
  return buildTree(files);
}
