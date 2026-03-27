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
  report         Generate quantitative insights dashboard
  review         Generate qualitative session analysis

Options:
  --archive <path>   Path to archive directory
  --help             Show help
  --version          Show version

Examples:
  debrief init ~/my-sessions
  debrief connect
  debrief collect
  debrief collect --dry-run
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

async function main() {
  switch (command) {
    case "init": {
      const { run } = await import("../src/init.mjs");
      await run({ dir: flags._[0] });
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
