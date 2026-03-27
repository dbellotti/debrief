import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function listJsonl(dir) {
  const results = [];
  async function walk(d) {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith(".jsonl")) results.push(full);
    }
  }
  await walk(dir);
  return results;
}

export function parseJsonlLines(text) {
  return text.split("\n").filter(l => l.trim()).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

export function idFromFilename(filepath) {
  const base = filepath.split("/").pop().replace(".jsonl", "");
  return base || "unknown";
}
