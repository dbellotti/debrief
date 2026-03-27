# debrief

Sync, analyze, and visualize your Claude Code and Codex sessions.

`debrief` is a CLI that archives your AI coding sessions and generates two kinds of reports:
- **Quantitative** — an interactive HTML dashboard with token usage, activity heatmaps, trends, and tool breakdowns
- **Qualitative** — LLM-powered analysis of session goals, outcomes, friction points, and recommendations

Zero runtime dependencies. Shells out to `claude` / `codex` CLIs for qualitative analysis.

## Install

```sh
# Via nix flake (recommended)
nix profile install github:dbellotti/debrief

# Or run directly
nix run github:dbellotti/debrief -- --help

# Or clone and alias
git clone https://github.com/dbellotti/debrief.git
alias debrief="node ~/path/to/debrief/bin/debrief.mjs"
```

Requires Node.js >= 18.

## Quick start

```sh
# Set up an archive directory
debrief init ~/my-sessions
cd ~/my-sessions

# Hook into Claude Code for automatic capture
debrief connect

# Backfill existing sessions
debrief collect

# Generate reports
debrief report --dark
debrief review --dark
```

## Commands

### `debrief init [dir]`

Bootstrap a new session archive. Creates `machines/`, `facets/`, and `.gitignore`.

### `debrief connect`

Install a Claude Code SessionEnd hook for automatic session capture.

```sh
debrief connect            # install hook
debrief connect --status   # check if installed
debrief connect --remove   # uninstall hook
```

### `debrief collect`

Sync sessions from `~/.claude` and `~/.codex` into the archive.

```sh
debrief collect                # full sync
debrief collect --dry-run      # preview
debrief collect --claude-only  # Claude Code only
debrief collect --codex-only   # Codex only
debrief collect --commit       # git commit after sync
```

Also supports `--stdin` for hook-driven single-file ingest (used internally by `debrief connect`).

### `debrief report`

Generate a quantitative HTML dashboard.

```sh
debrief report                 # all providers
debrief report --dark          # dark theme
debrief report --claude        # Claude sessions only
debrief report -o out.html     # custom output path
```

### `debrief review`

Generate LLM-powered qualitative analysis. Requires `claude` CLI on PATH.

```sh
debrief review                        # all sessions
debrief review --dark                 # dark theme
debrief review --concurrency 8        # parallel LLM calls
debrief review --from 2025-01-01      # date filter
debrief review --to 2025-06-01        # date filter
debrief review --project myapp        # project filter
debrief review --machine db-mini      # machine filter
debrief review --min-duration 120     # skip short sessions (seconds)
debrief review --min-turns 3          # skip shallow sessions
```

Caches per-session facets in `<archive>/facets/`. Re-runs only analyze new sessions.

## Archive resolution

The tool finds your archive directory in this order:

1. `--archive <path>` flag
2. `DEBRIEF_DIR` environment variable
3. If the current directory contains `machines/`, use it
4. `~/.local/share/debrief` as default

Set-and-forget: `export DEBRIEF_DIR=~/my-sessions` in your shell profile.

## How it works

**Two-layer capture:**

1. **SessionEnd hook** (automatic) — when Claude Code exits, the hook copies the session transcript to your archive
2. **Full sync** (manual/scheduled) — `debrief collect` rsyncs all sessions as a catch-up safety net

For belt-and-suspenders:

```sh
0 */6 * * * debrief collect --commit  # cron sync every 6 hours
```

## License

Apache 2.0
