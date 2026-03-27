import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const HOOK_COMMAND = "debrief collect --stdin";

export async function run(opts) {
  if (opts.status) {
    const installed = await isInstalled();
    console.log(installed ? "Hook is installed." : "Hook is not installed.");
    return;
  }

  if (opts.remove) {
    await removeHook();
    console.log("Hook removed.");
    return;
  }

  await installHook();
  console.log("SessionEnd hook installed.");
  console.log("Sessions will automatically archive when Claude Code exits.");
}

async function loadSettings() {
  if (!existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(await readFile(SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

async function saveSettings(settings) {
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

async function isInstalled() {
  const settings = await loadSettings();
  const hooks = settings.hooks?.SessionEnd;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(entry =>
    Array.isArray(entry.hooks) && entry.hooks.some(h => h.command === HOOK_COMMAND)
  );
}

async function installHook() {
  const settings = await loadSettings();
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.SessionEnd)) settings.hooks.SessionEnd = [];

  const already = settings.hooks.SessionEnd.some(entry =>
    Array.isArray(entry.hooks) && entry.hooks.some(h => h.command === HOOK_COMMAND)
  );
  if (already) {
    console.log("Hook is already installed.");
    return;
  }

  settings.hooks.SessionEnd.push({
    hooks: [{
      type: "command",
      command: HOOK_COMMAND,
    }]
  });

  await saveSettings(settings);
}

async function removeHook() {
  const settings = await loadSettings();
  if (!settings.hooks?.SessionEnd) return;

  settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(entry =>
    !(Array.isArray(entry.hooks) && entry.hooks.some(h => h.command === HOOK_COMMAND))
  );

  if (settings.hooks.SessionEnd.length === 0) delete settings.hooks.SessionEnd;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  await saveSettings(settings);
}
