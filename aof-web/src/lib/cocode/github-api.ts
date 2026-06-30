// ── GitHub REST API Client (Phase 4) ─────────────────────────────────────────
// Wraps the GitHub REST API for all Git operations. No git binary needed —
// everything goes through HTTPS API calls, which is safe for a serverless env.

export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
}

export interface GitHubRepo {
  full_name: string;       // "owner/repo"
  name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  description: string | null;
  html_url: string;
  clone_url: string;
  pushed_at: string;
  stargazers_count: number;
  language: string | null;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string; url: string };
  protected: boolean;
}

export interface GitHubTreeItem {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

export interface GitHubBlob {
  content: string;      // base64-encoded
  encoding: "base64";
  sha: string;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
  html_url: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed" | "merged";
  head: { ref: string; sha: string };
  base: { ref: string };
  created_at: string;
}

// ── API helper ────────────────────────────────────────────────────────────────

async function ghFetch<T>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new GitHubError(
      (err as { message?: string }).message ?? res.statusText,
      res.status,
    );
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

export class GitHubError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "GitHubError";
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getAuthenticatedUser(token: string): Promise<GitHubUser> {
  return ghFetch<GitHubUser>(token, "/user");
}

export async function listRepos(
  token: string,
  per_page = 50,
): Promise<GitHubRepo[]> {
  return ghFetch<GitHubRepo[]>(
    token,
    `/user/repos?sort=pushed&per_page=${per_page}&affiliation=owner,collaborator`,
  );
}

export async function getRepo(token: string, fullName: string): Promise<GitHubRepo> {
  return ghFetch<GitHubRepo>(token, `/repos/${fullName}`);
}

export async function listBranches(
  token: string,
  fullName: string,
): Promise<GitHubBranch[]> {
  return ghFetch<GitHubBranch[]>(token, `/repos/${fullName}/branches?per_page=100`);
}

export async function createBranch(
  token: string,
  fullName: string,
  branchName: string,
  fromSha: string,
): Promise<void> {
  await ghFetch(token, `/repos/${fullName}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
  });
}

// Fetch full file tree (recursive)
export async function getTree(
  token: string,
  fullName: string,
  branch: string,
): Promise<GitHubTreeItem[]> {
  const res = await ghFetch<{ tree: GitHubTreeItem[]; truncated: boolean }>(
    token,
    `/repos/${fullName}/git/trees/${branch}?recursive=1`,
  );
  return res.tree.filter((item) => item.type === "blob");
}

// Fetch a single file's content (decoded from base64)
export async function getFileContent(
  token: string,
  fullName: string,
  path: string,
  ref?: string,
): Promise<{ content: string; sha: string }> {
  const query = ref ? `?ref=${ref}` : "";
  const blob = await ghFetch<{ content: string; encoding: string; sha: string }>(
    token,
    `/repos/${fullName}/contents/${path}${query}`,
  );
  const content =
    blob.encoding === "base64"
      ? atob(blob.content.replace(/\n/g, ""))
      : blob.content;
  return { content, sha: blob.sha };
}

// Create or update a file
export async function putFileContent(
  token: string,
  fullName: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string,
): Promise<{ sha: string; commit: { sha: string } }> {
  const encoded = btoa(unescape(encodeURIComponent(content)));
  const body: Record<string, string> = { message, content: encoded, branch };
  if (sha) body.sha = sha;

  const res = await ghFetch<{ content: { sha: string }; commit: { sha: string } }>(
    token,
    `/repos/${fullName}/contents/${path}`,
    { method: "PUT", body: JSON.stringify(body) },
  );
  return { sha: res.content.sha, commit: res.commit };
}

export async function deleteGitHubFile(
  token: string,
  fullName: string,
  path: string,
  message: string,
  sha: string,
  branch: string,
): Promise<void> {
  await ghFetch(token, `/repos/${fullName}/contents/${path}`, {
    method: "DELETE",
    body: JSON.stringify({ message, sha, branch }),
  });
}

export async function listCommits(
  token: string,
  fullName: string,
  branch?: string,
  per_page = 30,
): Promise<GitHubCommit[]> {
  const query = branch ? `?sha=${branch}&per_page=${per_page}` : `?per_page=${per_page}`;
  return ghFetch<GitHubCommit[]>(token, `/repos/${fullName}/commits${query}`);
}

export async function createPR(
  token: string,
  fullName: string,
  title: string,
  head: string,
  base: string,
  body: string,
): Promise<GitHubPR> {
  return ghFetch<GitHubPR>(token, `/repos/${fullName}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, head, base, body }),
  });
}

export async function listPRs(
  token: string,
  fullName: string,
  state: "open" | "closed" | "all" = "open",
): Promise<GitHubPR[]> {
  return ghFetch<GitHubPR[]>(token, `/repos/${fullName}/pulls?state=${state}&per_page=30`);
}

// Check if a branch is protected (conflict detection)
export async function isBranchProtected(
  token: string,
  fullName: string,
  branch: string,
): Promise<boolean> {
  try {
    await ghFetch(token, `/repos/${fullName}/branches/${branch}/protection`);
    return true;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return false;
    return true; // assume protected on error
  }
}

// ── Batch load files under a size threshold (skip binaries) ──────────────────
const MAX_FILE_SIZE = 200_000; // 200 KB — skip large files
const SKIP_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "avif",
  "woff", "woff2", "ttf", "eot",
  "mp3", "mp4", "wav", "ogg",
  "zip", "tar", "gz", "lock",
  "min.js", "min.css",
]);

function shouldSkip(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (SKIP_EXTS.has(ext)) return true;
  if (path.includes("node_modules/")) return true;
  if (path.includes(".next/")) return true;
  if (path.includes("dist/")) return true;
  return false;
}

export async function loadRepoFiles(
  token: string,
  fullName: string,
  branch: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Array<{ path: string; content: string; sha: string }>> {
  const tree = await getTree(token, fullName, branch);
  const eligible = tree.filter(
    (item) => !shouldSkip(item.path) && (item.size ?? 0) < MAX_FILE_SIZE,
  );

  const results: Array<{ path: string; content: string; sha: string }> = [];
  const BATCH = 5;

  for (let i = 0; i < eligible.length; i += BATCH) {
    const batch = eligible.slice(i, i + BATCH);
    const fetched = await Promise.allSettled(
      batch.map((item) => getFileContent(token, fullName, item.path, branch)),
    );
    for (let j = 0; j < batch.length; j++) {
      const r = fetched[j];
      if (r.status === "fulfilled") {
        results.push({ path: batch[j].path, content: r.value.content, sha: r.value.sha });
      }
    }
    onProgress?.(Math.min(i + BATCH, eligible.length), eligible.length);
  }

  return results;
}
