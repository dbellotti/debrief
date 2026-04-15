import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { isRemote } from "./remote.mjs";

export function readConfig() {
  const configDir = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "debrief")
    : join(homedir(), ".config", "debrief");
  const configPath = join(configDir, "config.json");
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {}
  }
  return null;
}

function resolvePath(p) {
  return isRemote(p) ? p : resolve(p);
}

export function resolveArchive(flags = {}) {
  if (flags.archive) return resolvePath(flags.archive);

  const config = readConfig();
  if (config?.archive) return resolvePath(config.archive);

  if (process.env.DEBRIEF_DIR) return resolvePath(process.env.DEBRIEF_DIR);
  if (existsSync(join(process.cwd(), "machines"))) return process.cwd();
  return join(homedir(), ".local", "share", "debrief", "archive");
}

export function configPath() {
  const configDir = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "debrief")
    : join(homedir(), ".config", "debrief");
  return join(configDir, "config.json");
}
