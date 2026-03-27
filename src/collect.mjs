import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, hostname } from "node:os";

const execFileAsync = promisify(execFile);

export async function run(opts) {
  if (opts.stdin) {
    await ingestStdin(opts);
    return;
  }
  await fullSync(opts);
}

async function ingestStdin(opts) {
  const archiveDir = opts.archive;
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    console.error("Could not parse stdin as JSON");
    process.exit(1);
  }

  const transcriptPath = payload.session?.transcript_path || payload.transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) {
    console.error("No valid transcript_path in hook payload");
    process.exit(1);
  }

  const host = hostname().replace(/\.local$/, "");
  const claudeDir = join(homedir(), ".claude");
  let relPath;
  if (transcriptPath.startsWith(claudeDir)) {
    relPath = join("claude", transcriptPath.slice(claudeDir.length + 1));
  } else {
    relPath = transcriptPath.split("/").slice(-3).join("/");
  }

  const destPath = join(archiveDir, "machines", host, relPath);
  await mkdir(dirname(destPath), { recursive: true });
  await copyFile(transcriptPath, destPath);
  console.log(`Archived: ${destPath}`);
}

async function fullSync(opts) {
  const archiveDir = opts.archive;
  const host = hostname().replace(/\.local$/, "");
  const dest = join(archiveDir, "machines", host);

  const claudeDir = process.env.CLAUDE_DIR || join(homedir(), ".claude");
  const codexDir = process.env.CODEX_DIR || join(homedir(), ".codex");

  const syncClaude = !opts.codexOnly;
  const syncCodex = !opts.claudeOnly;

  let synced = false;

  if (syncClaude) {
    const src = join(claudeDir, "projects");
    if (existsSync(src)) {
      console.log("=== Claude Code ===");
      console.log(`  Source: ${src}/`);
      console.log(`  Dest:   ${dest}/claude/projects/`);

      if (opts.dryRun) {
        await rsync(src + "/", dest + "/claude/projects/", true);
      } else {
        await mkdir(join(dest, "claude", "projects"), { recursive: true });
        await rsync(src + "/", dest + "/claude/projects/", false);
        synced = true;
      }
      console.log("");
    } else {
      console.log(`Skipping Claude Code (no projects dir at ${src})`);
    }
  }

  if (syncCodex) {
    const src = join(codexDir, "sessions");
    if (existsSync(src)) {
      console.log("=== Codex ===");
      console.log(`  Sessions: ${src}/`);
      console.log(`       --> ${dest}/codex/sessions/`);

      if (opts.dryRun) {
        await rsync(src + "/", dest + "/codex/sessions/", true);
      } else {
        await mkdir(join(dest, "codex", "sessions"), { recursive: true });
        await rsync(src + "/", dest + "/codex/sessions/", false);
        synced = true;
      }

      for (const f of ["history.jsonl", "session_index.jsonl"]) {
        const fp = join(codexDir, f);
        if (existsSync(fp)) {
          console.log(`  ${f}`);
          if (!opts.dryRun) {
            await mkdir(join(dest, "codex"), { recursive: true });
            await copyFile(fp, join(dest, "codex", f));
          }
        }
      }
      console.log("");
    } else {
      console.log(`Skipping Codex (no sessions dir at ${codexDir}/sessions)`);
    }
  }

  if (opts.dryRun) return;
  if (!synced) {
    console.log("Nothing to sync.");
    return;
  }

  if (opts.commit) {
    await gitCommit(archiveDir, host);
  }

  console.log("Done.");
}

async function rsync(src, dest, dryRun) {
  const args = ["-av", "--include=*/", "--include=*.jsonl", "--exclude=*"];
  if (dryRun) args.push("--dry-run");
  args.push(src, dest);

  try {
    const { stdout } = await execFileAsync("rsync", args);
    if (stdout.trim()) console.log(stdout.trim());
  } catch (e) {
    console.error(`rsync failed: ${e.message}`);
  }
}

async function gitCommit(archiveDir, host) {
  try {
    await execFileAsync("git", ["-C", archiveDir, "rev-parse", "--git-dir"]);
  } catch {
    console.log("Archive is not a git repo, skipping commit.");
    return;
  }

  try {
    const { stdout: status } = await execFileAsync("git", ["-C", archiveDir, "status", "--porcelain"]);
    if (!status.trim()) {
      console.log("No new session data to commit.");
      return;
    }

    await execFileAsync("git", ["-C", archiveDir, "add", `machines/${host}/`]);
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    const { stdout: diffOutput } = await execFileAsync("git", ["-C", archiveDir, "diff", "--cached", "--name-only"]);
    const fileCount = diffOutput.trim().split("\n").filter(Boolean).length;
    await execFileAsync("git", ["-C", archiveDir, "commit", "-m", `sync: ${host} - ${ts} (${fileCount} files changed)`]);
    console.log("Committed.");
  } catch (e) {
    console.error(`Git commit failed: ${e.message}`);
  }
}
