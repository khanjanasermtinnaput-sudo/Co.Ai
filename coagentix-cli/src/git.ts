// Git integration via simple-git

import simpleGit, { type SimpleGit } from "simple-git";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function getGit(root: string): SimpleGit {
  return simpleGit(root);
}

export async function isGitRepo(root: string): Promise<boolean> {
  return existsSync(join(root, ".git"));
}

export async function getCurrentBranch(git: SimpleGit): Promise<string> {
  const status = await git.status();
  return status.current ?? "HEAD";
}

export async function getBranches(git: SimpleGit): Promise<string[]> {
  const result = await git.branch();
  return result.all;
}

export async function createBranch(git: SimpleGit, name: string): Promise<void> {
  await git.checkoutLocalBranch(name);
}

export async function switchBranch(git: SimpleGit, name: string): Promise<void> {
  await git.checkout(name);
}

export async function getStatus(git: SimpleGit) {
  return git.status();
}

export async function getDiff(git: SimpleGit, staged = false): Promise<string> {
  return staged ? git.diff(["--cached"]) : git.diff();
}

export async function stageAll(git: SimpleGit): Promise<void> {
  await git.add(".");
}

export async function stageFiles(git: SimpleGit, paths: string[]): Promise<void> {
  await git.add(paths);
}

export async function commit(git: SimpleGit, message: string): Promise<string> {
  const result = await git.commit(message);
  return result.commit;
}

export async function push(git: SimpleGit, remote = "origin", branch?: string): Promise<void> {
  const current = branch ?? (await getCurrentBranch(git));
  await git.push(remote, current);
}

export async function pull(git: SimpleGit, remote = "origin"): Promise<void> {
  await git.pull(remote);
}

export async function getLog(git: SimpleGit, limit = 20): Promise<Array<{
  hash: string;
  message: string;
  author: string;
  date: string;
}>> {
  const log = await git.log({ maxCount: limit });
  return log.all.map((c) => ({
    hash:    c.hash.slice(0, 7),
    message: c.message,
    author:  c.author_name,
    date:    c.date,
  }));
}

export async function detectConflicts(git: SimpleGit): Promise<string[]> {
  const status = await git.status();
  return status.conflicted;
}

export async function generateCommitSummary(git: SimpleGit): Promise<string> {
  const diff = await getDiff(git, true);
  if (!diff.trim()) {
    const unstagedDiff = await getDiff(git, false);
    if (!unstagedDiff.trim()) return "No changes to summarise";
    return `Changes (unstaged):\n${unstagedDiff.slice(0, 2000)}`;
  }
  return `Staged diff:\n${diff.slice(0, 2000)}`;
}
