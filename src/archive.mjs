import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isRemote } from "./remote.mjs";
import { readConfig } from "./resolve-archive.mjs";

const execFileAsync = promisify(execFile);

export function getArchiveType(archivePath) {
  if (isRemote(archivePath)) return "ssh";
  const config = readConfig();
  if (config?.type === "git") return "git";
  return "local";
}

export async function gitPull(archivePath) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", archivePath, "remote"]);
    if (!stdout.trim()) return;
    await execFileAsync("git", ["-C", archivePath, "pull", "--rebase", "--autostash"]);
  } catch (e) {
    const msg = e.stderr?.trim() || e.message;
    if (msg && !msg.includes("Could not resolve")) {
      console.log(`Git pull: ${msg}`);
    }
  }
}

export async function gitCommitAndPush(archivePath, message) {
  try {
    const { stdout: status } = await execFileAsync("git", ["-C", archivePath, "status", "--porcelain"]);
    if (!status.trim()) return false;

    await execFileAsync("git", ["-C", archivePath, "add", "-A"]);
    await execFileAsync("git", ["-C", archivePath, "commit", "-m", message]);

    try {
      const { stdout: remote } = await execFileAsync("git", ["-C", archivePath, "remote"]);
      if (remote.trim()) {
        try {
          await execFileAsync("git", ["-C", archivePath, "pull", "--rebase", "--autostash"]);
        } catch {}
        try {
          await execFileAsync("git", ["-C", archivePath, "push"]);
        } catch {
          await execFileAsync("git", ["-C", archivePath, "push", "-u", "origin", "main"]);
        }
      }
    } catch (e) {
      console.log(`Push failed (committed locally): ${e.stderr?.trim() || e.message}`);
    }
    return true;
  } catch (e) {
    console.error(`Git commit failed: ${e.stderr?.trim() || e.message}`);
    return false;
  }
}
