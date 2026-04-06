import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir as localMkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

const REMOTE_RE = /^(?:([^@/:]+)@)?([^:/]+):(.+)$/;

export function isRemote(archivePath) {
  return REMOTE_RE.test(archivePath);
}

export function parseRemote(archivePath) {
  const m = archivePath.match(REMOTE_RE);
  if (!m) return null;
  return { user: m[1] || null, host: m[2], path: m[3] };
}

function sshTarget(parsed) {
  return parsed.user ? `${parsed.user}@${parsed.host}` : parsed.host;
}

// Build an rsync-compatible path: user@host:/path/sub for remote, /path/sub for local
export function rsyncPath(archivePath, subpath) {
  const remote = parseRemote(archivePath);
  if (remote) {
    const full = subpath ? `${remote.path}/${subpath}` : remote.path;
    return `${sshTarget(remote)}:${full}`;
  }
  return subpath ? join(archivePath, subpath) : archivePath;
}

// mkdir -p locally or via ssh
export async function ensureDir(archivePath, subpath) {
  const remote = parseRemote(archivePath);
  if (remote) {
    const full = subpath ? `${remote.path}/${subpath}` : remote.path;
    await execFileAsync("ssh", [sshTarget(remote), `mkdir -p '${full}'`]);
  } else {
    await localMkdir(subpath ? join(archivePath, subpath) : archivePath, { recursive: true });
  }
}

// Run a shell command on the archive host (or locally)
export async function exec(archivePath, cmd) {
  const remote = parseRemote(archivePath);
  if (remote) {
    return await execFileAsync("ssh", [sshTarget(remote), cmd]);
  }
  return await execFileAsync("sh", ["-c", cmd]);
}

// Write a file on the archive host
export async function writeRemoteFile(archivePath, subpath, content) {
  const remote = parseRemote(archivePath);
  if (remote) {
    const full = `${remote.path}/${subpath}`;
    await execFileAsync("ssh", [sshTarget(remote), `cat > '${full}'`], { input: content });
  } else {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(archivePath, subpath), content, "utf-8");
  }
}

// Check if a path exists on the archive host
export async function existsRemote(archivePath, subpath) {
  const remote = parseRemote(archivePath);
  if (remote) {
    try {
      const full = `${remote.path}/${subpath}`;
      await execFileAsync("ssh", [sshTarget(remote), `test -e '${full}'`]);
      return true;
    } catch {
      return false;
    }
  }
  const { existsSync } = await import("node:fs");
  return existsSync(join(archivePath, subpath));
}

// Rsync a subdirectory from archive to a local path
async function syncDown(archivePath, subpath, localPath) {
  const src = rsyncPath(archivePath, subpath) + "/";
  await localMkdir(localPath, { recursive: true });
  await execFileAsync("rsync", ["-a", src, localPath + "/"]);
}

// Rsync a local path back up to the archive
async function syncUp(localPath, archivePath, subpath) {
  const dest = rsyncPath(archivePath, subpath) + "/";
  await ensureDir(archivePath, subpath);
  await execFileAsync("rsync", ["-a", localPath + "/", dest]);
}

// Get a local working copy of the archive.
// For local archives, returns the path directly.
// For remote archives, syncs requested subdirs to a temp dir.
// Returns { localPath, cleanup(), syncBack(...subdirs) }
export async function localMirror(archivePath, subdirs) {
  if (!isRemote(archivePath)) {
    return {
      localPath: archivePath,
      cleanup: async () => {},
      syncBack: async () => {},
    };
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "debrief-"));

  for (const sub of subdirs) {
    try {
      await syncDown(archivePath, sub, join(tmpDir, sub));
    } catch {
      // Dir might not exist on remote yet
      await localMkdir(join(tmpDir, sub), { recursive: true });
    }
  }

  return {
    localPath: tmpDir,
    cleanup: async () => {
      const { rm } = await import("node:fs/promises");
      await rm(tmpDir, { recursive: true, force: true });
    },
    syncBack: async (...subs) => {
      for (const sub of subs) {
        await syncUp(join(tmpDir, sub), archivePath, sub);
      }
    },
  };
}
