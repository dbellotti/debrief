import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export function resolveArchive(flags = {}) {
  if (flags.archive) return resolve(flags.archive);
  if (process.env.DEBRIEF_DIR) return resolve(process.env.DEBRIEF_DIR);
  if (existsSync(join(process.cwd(), "machines"))) return process.cwd();
  return join(homedir(), ".local", "share", "debrief");
}
