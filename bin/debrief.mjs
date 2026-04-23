#!/usr/bin/env node
import { resolve } from "node:path";
import { resolveArchive } from "../src/resolve-archive.mjs";

const args = process.argv.slice(2);

// Handle global flags before command
if (args[0] === "--version" || args[0] === "-v") {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(await readFile(join(__dirname, "..", "package.json"), "utf-8"));
  console.log(`debrief ${pkg.version}`);
  process.exit(0);
}
if (args[0] === "--help" || args[0] === "-h" || !args[0]) {
  console.log(`Usage: debrief <command> [options]

Commands:
  init [dir]     Set up a new session archive
  connect        Hook into Claude Code for automatic capture
  collect        Sync sessions to the archive
  schedule       Install/remove scheduled collection service
  report         Generate quantitative insights dashboard
  review         Generate qualitative session analysis

Options:
  --archive <path>   Path to archive directory
  --help             Show help (use <command> --help for command options)
  --version          Show version

Archive types:
  /local/path            Local filesystem
  user@host:/path        Remote filesystem (SSH + rsync)
  --git <repo-url>       Git repo (clone + commit + push)

Examples:
  debrief init ~/my-sessions
  debrief init --git git@github.com:you/sessions.git
  debrief connect
  debrief collect
  debrief report --dark
  debrief review --dark --from 2025-01-01`);
  process.exit(args[0] ? 0 : 1);
}

const command = args[0];

function parseFlags(args) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--archive" && i + 1 < args.length) { flags.archive = args[++i]; }
    else if (arg === "--dark") { flags.dark = true; }
    else if (arg === "--dry-run") { flags.dryRun = true; }
    else if (arg === "--claude-only" || arg === "--claude") { flags.claude = true; flags.claudeOnly = true; }
    else if (arg === "--codex-only" || arg === "--codex") { flags.codex = true; flags.codexOnly = true; }
    else if (arg === "--commit") { flags.commit = true; }
    else if (arg === "--stdin") { flags.stdin = true; }
    else if (arg === "--git" && i + 1 < args.length) { flags.git = args[++i]; }
    else if (arg === "--cron" && i + 1 < args.length) { flags.cron = args[++i]; }
    else if (arg === "--status") { flags.status = true; }
    else if (arg === "--remove") { flags.remove = true; }
    else if (arg === "--concurrency" && i + 1 < args.length) { flags.concurrency = parseInt(args[++i]); }
    else if (arg === "--from" && i + 1 < args.length) { flags.from = args[++i]; }
    else if (arg === "--to" && i + 1 < args.length) { flags.to = args[++i]; }
    else if (arg === "--project" && i + 1 < args.length) { flags.project = args[++i]; }
    else if (arg === "--machine" && i + 1 < args.length) { flags.machine = args[++i]; }
    else if (arg === "--min-duration" && i + 1 < args.length) { flags.minDuration = parseInt(args[++i]); }
    else if (arg === "--min-turns" && i + 1 < args.length) { flags.minTurns = parseInt(args[++i]); }
    else if (arg === "-o" && i + 1 < args.length) { flags.output = resolve(args[++i]); }
    else if (arg === "--help" || arg === "-h") { flags.help = true; }
    else if (arg === "--version" || arg === "-v") { flags.version = true; }
    else if (!arg.startsWith("-")) { flags._.push(arg); }
    else { console.error(`Unknown option: ${arg}`); process.exit(1); }
  }
  return flags;
}

const flags = parseFlags(args.slice(1));

const commandHelp = {
  init: `Usage: debrief init [dir] [options]

Set up a new session archive.

Options:
  --git <repo-url>   Initialize as a git-managed archive
  --help             Show this help

Examples:
  debrief init ~/my-sessions
  debrief init --git git@github.com:you/sessions.git`,

  connect: `Usage: debrief connect [options]

Install/remove the Claude Code SessionEnd hook for automatic capture.

Options:
  --status           Check if hook is installed
  --remove           Remove the hook
  --help             Show this help`,

  collect: `Usage: debrief collect [options]

Sync Claude Code and Codex sessions to the archive.

Options:
  --archive <path>   Path to archive directory
  --claude-only      Only sync Claude Code sessions
  --codex-only       Only sync Codex sessions
  --dry-run          Show what would be synced without syncing
  --commit           Git commit after sync (filesystem archives)
  --stdin            Ingest a single session from stdin (used by hooks)
  --help             Show this help`,

  schedule: `Usage: debrief schedule [options]

Install/remove a scheduled service that runs debrief collect.
Uses systemd user timers on Linux and launchd agents on macOS.

Options:
  --cron <expr>      Cron schedule (default: "0 3 * * *" = nightly 3am)
  --status           Show schedule status
  --remove           Remove the scheduled service
  --help             Show this help

Examples:
  debrief schedule
  debrief schedule --cron "0 */6 * * *"
  debrief schedule --status
  debrief schedule --remove`,

  report: `Usage: debrief report [options]

Generate a quantitative insights dashboard (HTML).

Options:
  --archive <path>   Path to archive directory
  --dark             Dark theme
  --from <date>      Start date filter (YYYY-MM-DD)
  --to <date>        End date filter (YYYY-MM-DD)
  --project <name>   Filter by project
  --machine <name>   Filter by machine
  -o <path>          Output file path
  --help             Show this help`,

  review: `Usage: debrief review [options]

Generate qualitative session analysis via LLM.

Options:
  --archive <path>   Path to archive directory
  --dark             Dark theme
  --from <date>      Start date filter (YYYY-MM-DD)
  --to <date>        End date filter (YYYY-MM-DD)
  --project <name>   Filter by project
  --machine <name>   Filter by machine
  --min-duration <s> Minimum session duration in seconds
  --min-turns <n>    Minimum number of turns
  --concurrency <n>  Parallel LLM requests
  -o <path>          Output file path
  --help             Show this help`,
};

async function main() {
  if (flags.help && commandHelp[command]) {
    console.log(commandHelp[command]);
    process.exit(0);
  }

  switch (command) {
    case "init": {
      const { run } = await import("../src/init.mjs");
      await run({ dir: flags._[0], git: flags.git });
      break;
    }
    case "connect": {
      const { run } = await import("../src/connect.mjs");
      await run(flags);
      break;
    }
    case "collect": {
      const archive = resolveArchive(flags);
      const { run } = await import("../src/collect.mjs");
      await run({ ...flags, archive });
      break;
    }
    case "schedule": {
      const { run } = await import("../src/schedule.mjs");
      await run(flags);
      break;
    }
    case "report": {
      const archive = resolveArchive(flags);
      const { run } = await import("../src/report.mjs");
      await run({ ...flags, archive });
      break;
    }
    case "review": {
      const archive = resolveArchive(flags);
      const { run } = await import("../src/review.mjs");
      await run({ ...flags, archive });
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'debrief --help' for usage.");
      process.exit(1);
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
