import { resolve, join, dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { isRemote, ensureDir, existsRemote, writeRemoteFile } from "./remote.mjs";
import { gitCommitAndPush } from "./archive.mjs";
import { configPath } from "./resolve-archive.mjs";

const execFileAsync = promisify(execFile);

async function saveConfig(config) {
  const cp = configPath();
  await mkdir(dirname(cp), { recursive: true });
  await writeFile(cp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  console.log(`Config saved to ${cp}`);
}

export async function run(opts) {
  if (opts.git) {
    await initGit(opts);
    return;
  }

  const dir = opts.dir ? (isRemote(opts.dir) ? opts.dir : resolve(opts.dir)) : resolve(".");

  await ensureDir(dir, "machines");
  await ensureDir(dir, "facets");

  if (!(await existsRemote(dir, ".gitignore"))) {
    await writeRemoteFile(dir, ".gitignore", "machines/\n");
  }

  await saveConfig({ archive: dir });

  console.log(`Archive initialized at ${dir}`);
  console.log("Next steps:");
  console.log("  debrief connect    # hook into Claude Code for automatic capture");
  console.log("  debrief collect    # sync existing sessions");
}

async function initGit(opts) {
  const repoUrl = opts.git;
  const dir = resolve(opts.dir || join(homedir(), ".local", "share", "debrief", "archive"));

  if (existsSync(join(dir, ".git"))) {
    console.log(`${dir} is already a git repo.`);
  } else if (existsSync(dir) && existsSync(join(dir, "machines"))) {
    console.log(`Initializing git in existing archive at ${dir}...`);
    await execFileAsync("git", ["-C", dir, "init"]);
    await execFileAsync("git", ["-C", dir, "remote", "add", "origin", repoUrl]);
  } else {
    console.log(`Cloning ${repoUrl}...`);
    try {
      await execFileAsync("git", ["clone", repoUrl, dir]);
    } catch {
      await mkdir(dir, { recursive: true });
      await execFileAsync("git", ["-C", dir, "init"]);
      await execFileAsync("git", ["-C", dir, "remote", "add", "origin", repoUrl]);
    }
  }

  await mkdir(join(dir, "machines"), { recursive: true });
  await mkdir(join(dir, "facets"), { recursive: true });

  if (!existsSync(join(dir, ".gitignore"))) {
    await writeFile(join(dir, ".gitignore"), "reports/\n", "utf-8");
  }

  const committed = await gitCommitAndPush(dir, "init: debrief archive");
  if (committed) console.log("Pushed initial structure.");

  await saveConfig({ archive: dir, type: "git", remote: repoUrl });

  console.log(`\nGit archive ready at ${dir}`);
  console.log(`Remote: ${repoUrl}`);
  console.log("\nNext steps:");
  console.log("  debrief connect    # hook into Claude Code for automatic capture");
  console.log("  debrief collect    # backfill existing sessions");
}
