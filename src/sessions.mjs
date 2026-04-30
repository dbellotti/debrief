import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { listJsonl, parseJsonlLines } from "./parsers/common.mjs";

/**
 * Load raw session data from an archive directory.
 * Returns array of { provider, filepath, raw, machine } tuples.
 * Callers apply their own transform (parse or condense) to each tuple.
 */
export async function loadSessionFiles(archiveDir, filters = {}) {
  const results = [];
  const providerFilter = filters.providers || null; // Set or null for all

  const machinesDir = join(archiveDir, "machines");
  let machineDirs;
  try { machineDirs = await readdir(machinesDir, { withFileTypes: true }); } catch { machineDirs = []; }

  for (const md of machineDirs) {
    if (!md.isDirectory()) continue;
    const machine = md.name;
    if (filters.machine && machine !== filters.machine) continue;
    const machineRoot = join(machinesDir, machine);

    // Codex sessions
    if (!providerFilter || providerFilter.has("codex")) {
      const codexSessions = join(machineRoot, "codex", "sessions");
      if (existsSync(codexSessions)) {
        for (const f of await listJsonl(codexSessions)) {
          try {
            const lines = parseJsonlLines(await readFile(f, "utf-8"));
            if (lines.length) results.push({ provider: "codex", filepath: f, raw: lines, machine });
          } catch {}
        }
      }
    }

    // Claude Code sessions
    if (!providerFilter || providerFilter.has("claude")) {
      const claudeProjects = join(machineRoot, "claude", "projects");
      if (existsSync(claudeProjects)) {
        for (const f of await listJsonl(claudeProjects)) {
          if (f.includes("/subagents/")) continue;
          try {
            const lines = parseJsonlLines(await readFile(f, "utf-8"));
            if (lines.length) results.push({ provider: "claude", filepath: f, raw: lines, machine });
          } catch {}
        }
      }
    }
  }

  // Cloud: claude.ai conversations
  const cloudDir = join(archiveDir, "cloud");
  if (!providerFilter || providerFilter.has("claude-ai")) {
    const claudeAiDir = join(cloudDir, "claude-ai");
    if (existsSync(claudeAiDir)) {
      let files;
      try { files = await readdir(claudeAiDir); } catch { files = []; }
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const filepath = join(claudeAiDir, f);
        try {
          const conv = JSON.parse(await readFile(filepath, "utf-8"));
          results.push({ provider: "claude-ai", filepath, raw: conv, machine: null });
        } catch {}
      }
    }
  }

  return results;
}
