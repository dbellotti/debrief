import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname } from "node:os";
import { ensureDir, rsyncPath, exec as remoteExec, localMirror } from "./remote.mjs";
import { getArchiveType, gitPull, gitCommitAndPush } from "./archive.mjs";
import { loadAuth } from "./auth.mjs";
import { createClient } from "./cloud/claude-ai.mjs";
import { createClient as createOpenAiClient } from "./cloud/openai.mjs";

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
  const archiveType = await getArchiveType(archiveDir);

  // Pull latest before ingesting to avoid push conflicts
  if (archiveType === "git") {
    await gitPull(archiveDir);
  }

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
    relPath = "claude/" + transcriptPath.slice(claudeDir.length + 1);
  } else {
    relPath = transcriptPath.split("/").slice(-3).join("/");
  }

  const destRel = `machines/${host}/${relPath}`;
  const parentRel = destRel.split("/").slice(0, -1).join("/");
  await ensureDir(archiveDir, parentRel);

  const dest = rsyncPath(archiveDir, destRel);
  await execFileAsync("rsync", ["-a", transcriptPath, dest]);
  console.log(`Archived: ${dest}`);

  if (archiveType === "git") {
    await gitCommitAndPush(archiveDir, `collect: ${host} - ${transcriptPath.split("/").pop()}`);
  }
}

async function fullSync(opts) {
  const archiveDir = opts.archive;
  const archiveType = await getArchiveType(archiveDir);
  const host = hostname().replace(/\.local$/, "");
  const machineRel = `machines/${host}`;

  const claudeDir = process.env.CLAUDE_DIR || join(homedir(), ".claude");
  const codexDir = process.env.CODEX_DIR || join(homedir(), ".codex");

  const hasFilter = opts.claudeCode || opts.codex || opts.claudeAi || opts.openai;
  const syncClaude = !hasFilter || !!opts.claudeCode;
  const syncCodex = !hasFilter || !!opts.codex;
  const syncCloudClaudeAi = !hasFilter || !!opts.claudeAi;
  const syncCloudOpenAi = !hasFilter || !!opts.openai;

  // Pull latest for git archives
  if (archiveType === "git") {
    await gitPull(archiveDir);
  }

  let synced = false;

  if (syncClaude) {
    const src = join(claudeDir, "projects");
    if (existsSync(src)) {
      const destDisplay = rsyncPath(archiveDir, `${machineRel}/claude/projects`);
      console.log("=== Claude Code ===");
      console.log(`  Source: ${src}/`);
      console.log(`  Dest:   ${destDisplay}/`);

      if (opts.dryRun) {
        await rsync(src + "/", rsyncPath(archiveDir, `${machineRel}/claude/projects`) + "/", true);
      } else {
        await ensureDir(archiveDir, `${machineRel}/claude/projects`);
        await rsync(src + "/", rsyncPath(archiveDir, `${machineRel}/claude/projects`) + "/", false);
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
      const destDisplay = rsyncPath(archiveDir, `${machineRel}/codex/sessions`);
      console.log("=== Codex ===");
      console.log(`  Sessions: ${src}/`);
      console.log(`       --> ${destDisplay}/`);

      if (opts.dryRun) {
        await rsync(src + "/", rsyncPath(archiveDir, `${machineRel}/codex/sessions`) + "/", true);
      } else {
        await ensureDir(archiveDir, `${machineRel}/codex/sessions`);
        await rsync(src + "/", rsyncPath(archiveDir, `${machineRel}/codex/sessions`) + "/", false);
        synced = true;
      }

      for (const f of ["history.jsonl", "session_index.jsonl"]) {
        const fp = join(codexDir, f);
        if (existsSync(fp)) {
          console.log(`  ${f}`);
          if (!opts.dryRun) {
            await ensureDir(archiveDir, `${machineRel}/codex`);
            await execFileAsync("rsync", ["-a", fp, rsyncPath(archiveDir, `${machineRel}/codex/${f}`)]);
          }
        }
      }
      console.log("");
    } else {
      console.log(`Skipping Codex (no sessions dir at ${codexDir}/sessions)`);
    }
  }

  // Cloud: claude.ai and ChatGPT web conversations
  let partialFailure = false;
  const auth = (syncCloudClaudeAi || syncCloudOpenAi) ? await loadAuth() : null;
  const applyCloudResult = (result) => {
    if (result === "synced" || result === "partial") synced = true;
    if (result === "error" || result === "partial") partialFailure = true;
  };
  if (syncCloudClaudeAi) {
    applyCloudResult(await syncCloud(auth, archiveDir, opts.dryRun));
  }
  if (syncCloudOpenAi) {
    applyCloudResult(await syncOpenAi(auth, archiveDir, opts.dryRun));
  }

  if (opts.dryRun) return;
  if (!synced) {
    console.log("Nothing to sync.");
    if (partialFailure) process.exit(1);
    return;
  }

  // Git archives always commit+push; filesystem archives only with --commit
  if (archiveType === "git") {
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    await gitCommitAndPush(archiveDir, `collect: ${host} - ${ts}`);
  } else if (opts.commit) {
    await gitCommitLegacy(archiveDir, host, machineRel);
  }

  console.log("Done.");
  if (partialFailure) process.exit(1);
}

const CLOUD_FETCH_DELAY = 500;

// Shared cloud conversation sync loop. Uses localMirror so SSH archives get a
// local working copy synced back after fetching. Returns "synced", "skipped",
// "error" (nothing fetched), or "partial" (auth expired after some fetches).
async function syncConversations(archiveDir, dryRun, { label, dir, credential, list, get, id, title, isUpToDate }) {
  console.log(`=== ${label} ===`);

  let conversations;
  try {
    conversations = await list();
  } catch (e) {
    if (e.name === "AuthError") {
      console.warn(`  Warning: ${credential} expired or invalid. Skipping cloud sync.`);
      return "error";
    }
    throw e;
  }

  const subdir = `cloud/${dir}`;
  const mirror = await localMirror(archiveDir, [subdir]);
  try {
    const cloudDir = join(mirror.localPath, "cloud", dir);
    await mkdir(cloudDir, { recursive: true });

    let fetched = 0;
    let skipped = 0;
    let authExpired = false;
    for (const conv of conversations) {
      const destPath = join(cloudDir, `${id(conv)}.json`);
      // Check if we already have this conversation and it's unchanged
      if (existsSync(destPath)) {
        try {
          const existing = JSON.parse(await readFile(destPath, "utf-8"));
          if (isUpToDate(existing, conv)) {
            skipped++;
            continue;
          }
        } catch {}
      }

      if (dryRun) {
        console.log(`  Would fetch: ${title(conv) || id(conv)}`);
        fetched++;
        continue;
      }

      // Rate limit
      if (fetched > 0) {
        await new Promise(r => setTimeout(r, CLOUD_FETCH_DELAY));
      }

      try {
        const full = await get(id(conv));
        await writeFile(destPath, JSON.stringify(full, null, 2) + "\n", "utf-8");
        fetched++;
      } catch (e) {
        if (e.name === "AuthError") {
          console.warn(`  Warning: ${credential} expired mid-sync.`);
          authExpired = true;
          break;
        }
        console.warn(`  Warning: failed to fetch ${id(conv)}: ${e.message}`);
      }
    }

    if (!dryRun && fetched > 0) {
      await mirror.syncBack(subdir);
    }

    console.log(`  ${fetched} fetched, ${skipped} up-to-date (${conversations.length} total)`);
    console.log("");
    if (authExpired) return fetched > 0 ? "partial" : "error";
    return fetched > 0 ? "synced" : "skipped";
  } finally {
    await mirror.cleanup();
  }
}

async function syncCloud(auth, archiveDir, dryRun) {
  if (!auth?.cookie || !auth?.orgId) {
    return "skipped";
  }
  const client = createClient(auth.cookie);
  return syncConversations(archiveDir, dryRun, {
    label: "Claude.ai",
    dir: "claude-ai",
    credential: "claude.ai cookie",
    list: () => client.listConversations(auth.orgId),
    get: (convId) => client.getConversation(auth.orgId, convId),
    id: (c) => c.uuid,
    title: (c) => c.name,
    isUpToDate: (existing, conv) => existing.updated_at === conv.updated_at,
  });
}

// ChatGPT timestamps come as epoch-second floats or ISO strings depending on
// the endpoint; normalize to whole seconds for comparison.
function toEpochSec(v) {
  if (v == null) return null;
  if (typeof v === "number") return Math.floor(v);
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

async function syncOpenAi(auth, archiveDir, dryRun) {
  if (!auth?.openai?.accessToken) {
    return "skipped";
  }
  const client = createOpenAiClient(auth.openai.accessToken);
  return syncConversations(archiveDir, dryRun, {
    label: "ChatGPT",
    dir: "openai",
    credential: "ChatGPT access token",
    list: () => client.listConversations(),
    get: (convId) => client.getConversation(convId),
    id: (c) => c.id,
    title: (c) => c.title,
    isUpToDate: (existing, conv) => {
      const a = toEpochSec(existing.update_time);
      return a !== null && a === toEpochSec(conv.update_time);
    },
  });
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

// Legacy git commit for non-git-type archives that happen to be git repos (--commit flag)
async function gitCommitLegacy(archiveDir, host, machineRel) {
  try {
    await remoteExec(archiveDir, `git -C '${archiveDir}' rev-parse --git-dir`);
  } catch {
    console.log("Archive is not a git repo, skipping commit.");
    return;
  }

  try {
    const { stdout: status } = await remoteExec(archiveDir, `git -C '${archiveDir}' status --porcelain`);
    if (!status.trim()) {
      console.log("No new session data to commit.");
      return;
    }

    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    await remoteExec(archiveDir, `cd '${archiveDir}' && git add '${machineRel}/' && git diff --cached --name-only | wc -l | xargs -I{} git commit -m 'sync: ${host} - ${ts} ({} files changed)'`);
    console.log("Committed.");
  } catch (e) {
    console.error(`Git commit failed: ${e.message}`);
  }
}
