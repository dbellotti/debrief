import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

const DEFAULT_CRON = "0 3 * * *";
const SERVICE_NAME = "debrief-collect";
const LAUNCHD_LABEL = "com.debrief.collect";

export async function run(opts) {
  if (opts.status) return status();
  if (opts.remove) return remove();
  return install(opts.cron || DEFAULT_CRON);
}

// --- Dispatch ---

async function install(cron) {
  validateCron(cron);
  if (process.platform === "linux") return installSystemd(cron);
  if (process.platform === "darwin") return installLaunchd(cron);
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}

async function remove() {
  if (process.platform === "linux") return removeSystemd();
  if (process.platform === "darwin") return removeLaunchd();
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}

async function status() {
  if (process.platform === "linux") return statusSystemd();
  if (process.platform === "darwin") return statusLaunchd();
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}

// --- Cron parsing ---

function validateCron(expr) {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    console.error(`Invalid cron expression: expected 5 fields, got ${fields.length}`);
    process.exit(1);
  }
  for (const f of fields) {
    if (!/^(\*|\d+|\*\/\d+)$/.test(f)) {
      console.error(`Unsupported cron field: ${f} (supported: *, N, */N)`);
      process.exit(1);
    }
  }
}

function parseCron(expr) {
  const [minute, hour, dom, month, dow] = expr.trim().split(/\s+/);
  return { minute, hour, dom, month, dow };
}

// --- Binary resolution ---

function resolveDebriefBin() {
  try {
    return execFileSync("which", ["debrief"], { encoding: "utf-8" }).trim();
  } catch {
    console.error("Could not find 'debrief' on PATH.");
    process.exit(1);
  }
}

// --- systemd (Linux) ---

function systemdDir() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user");
}

function servicePath() { return join(systemdDir(), `${SERVICE_NAME}.service`); }
function timerPath() { return join(systemdDir(), `${SERVICE_NAME}.timer`); }

function cronToOnCalendar(cron) {
  const { minute, hour, dom, month, dow } = parseCron(cron);
  const dowMap = { "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri", "6": "Sat", "7": "Sun" };

  function convert(f) {
    if (f === "*") return "*";
    const m = f.match(/^\*\/(\d+)$/);
    if (m) return `0/${m[1]}`;
    return f.padStart(2, "0");
  }

  const prefix = dow !== "*" ? (dowMap[dow] || dow) + " " : "";
  return `${prefix}*-${convert(month)}-${convert(dom)} ${convert(hour)}:${convert(minute)}:00`;
}

async function installSystemd(cron) {
  const bin = resolveDebriefBin();
  const calendar = cronToOnCalendar(cron);

  await mkdir(systemdDir(), { recursive: true });

  await writeFile(servicePath(), `[Unit]
Description=Debrief session collector

[Service]
Type=oneshot
ExecStart=${bin} collect
`);

  await writeFile(timerPath(), `[Unit]
Description=Run debrief collect on schedule

[Timer]
OnCalendar=${calendar}
Persistent=true

[Install]
WantedBy=timers.target
`);

  await execFileAsync("systemctl", ["--user", "daemon-reload"]);
  await execFileAsync("systemctl", ["--user", "enable", "--now", `${SERVICE_NAME}.timer`]);

  console.log("Installed systemd timer.");
  console.log(`  Schedule: ${cron} (${calendar})`);
  console.log(`  Timer:    ${timerPath()}`);
}

async function removeSystemd() {
  try {
    await execFileAsync("systemctl", ["--user", "disable", "--now", `${SERVICE_NAME}.timer`]);
  } catch {}

  for (const p of [servicePath(), timerPath()]) {
    if (existsSync(p)) await unlink(p);
  }

  try {
    await execFileAsync("systemctl", ["--user", "daemon-reload"]);
  } catch {}

  console.log("Removed systemd timer.");
}

async function statusSystemd() {
  if (!existsSync(timerPath())) {
    console.log("Schedule is not installed.");
    return;
  }
  try {
    const { stdout } = await execFileAsync("systemctl", [
      "--user", "list-timers", `${SERVICE_NAME}.timer`, "--no-pager",
    ]);
    console.log(stdout.trim());
  } catch (e) {
    console.error(`Could not query timer: ${e.message}`);
  }
}

// --- launchd (macOS) ---

function plistPath() {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

function expandField(field, min, max) {
  if (field === "*") return null;
  const step = field.match(/^\*\/(\d+)$/);
  if (step) {
    const s = parseInt(step[1]);
    const vals = [];
    for (let i = min; i <= max; i += s) vals.push(i);
    return vals;
  }
  return [parseInt(field)];
}

function cronToLaunchdIntervals(cron) {
  const { minute, hour, dom, month, dow } = parseCron(cron);
  const fields = [
    ["Minute", expandField(minute, 0, 59)],
    ["Hour", expandField(hour, 0, 23)],
    ["Day", expandField(dom, 1, 31)],
    ["Month", expandField(month, 1, 12)],
    ["Weekday", expandField(dow, 0, 6)],
  ];

  let combos = [{}];
  for (const [key, values] of fields) {
    if (!values) continue;
    const next = [];
    for (const combo of combos) {
      for (const v of values) next.push({ ...combo, [key]: v });
    }
    combos = next;
  }
  return combos;
}

function buildLaunchdPath(debriefBin) {
  const dirs = new Set([
    dirname(debriefBin),
    dirname(process.execPath),
    "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
  ]);
  return [...dirs].join(":");
}

function dictToXml(dict, indent) {
  return Object.entries(dict).map(([k, v]) =>
    `${indent}<key>${k}</key>\n${indent}<integer>${v}</integer>`
  ).join("\n");
}

function buildPlist(bin, envPath, intervals) {
  const intervalXml = intervals.length === 1
    ? `  <dict>\n${dictToXml(intervals[0], "    ")}\n  </dict>`
    : `  <array>\n${intervals.map(d =>
        `    <dict>\n${dictToXml(d, "      ")}\n    </dict>`
      ).join("\n")}\n  </array>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>collect</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${envPath}</string>
  </dict>
  <key>StartCalendarInterval</key>
${intervalXml}
</dict>
</plist>
`;
}

async function installLaunchd(cron) {
  const bin = resolveDebriefBin();
  const envPath = buildLaunchdPath(bin);
  const intervals = cronToLaunchdIntervals(cron);
  const plist = buildPlist(bin, envPath, intervals);

  const dest = plistPath();
  if (existsSync(dest)) {
    try { await execFileAsync("launchctl", ["unload", dest]); } catch {}
  }

  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, plist);
  await execFileAsync("launchctl", ["load", dest]);

  console.log("Installed launchd agent.");
  console.log(`  Schedule: ${cron}`);
  console.log(`  Plist:    ${dest}`);
}

async function removeLaunchd() {
  const dest = plistPath();
  if (!existsSync(dest)) {
    console.log("Schedule is not installed.");
    return;
  }
  try { await execFileAsync("launchctl", ["unload", dest]); } catch {}
  await unlink(dest);
  console.log("Removed launchd agent.");
}

async function statusLaunchd() {
  if (!existsSync(plistPath())) {
    console.log("Schedule is not installed.");
    return;
  }
  try {
    const { stdout } = await execFileAsync("launchctl", ["list", LAUNCHD_LABEL]);
    console.log(`Plist: ${plistPath()}`);
    console.log(stdout.trim());
  } catch {
    console.log("Schedule is installed but not currently loaded.");
    console.log(`  Plist: ${plistPath()}`);
  }
}
