# debrief

Sync, analyze, and visualize your Claude Code and Codex sessions.

`debrief` is a CLI that archives your AI coding sessions and generates two kinds of reports:
- **Quantitative** — an interactive HTML dashboard with token usage, activity heatmaps, trends, and tool breakdowns
- **Qualitative** — LLM-powered analysis of session goals, outcomes, friction points, and recommendations

Zero runtime dependencies. Shells out to `claude` / `codex` CLIs for qualitative analysis.

## Install

Requires Node.js >= 18. No npm dependencies.

### Clone and symlink

```sh
git clone https://github.com/dbellotti/debrief.git ~/.local/share/debrief-cli
ln -s ~/.local/share/debrief-cli/bin/debrief.mjs ~/.local/bin/debrief
```

To update, `git pull` in the clone directory.

### Nix

```sh
# Run without installing
nix run github:dbellotti/debrief -- --help

# Or install to your profile
nix profile install github:dbellotti/debrief
```

### Nix + home-manager

The flake also exports a home-manager module that declaratively manages the config file, PATH entry, and (optionally) git clone setup.

```nix
# flake.nix
inputs.debrief.url = "github:dbellotti/debrief";
```

```nix
imports = [ inputs.debrief.homeManagerModules.default ];

programs.debrief = {
  enable = true;
  package = inputs.debrief.packages.${system}.default;
  git.remote = "git@github.com:you/sessions.git";
};
```

On `home-manager switch`, this puts `debrief` on PATH, writes `~/.config/debrief/config.json`, and clones the git remote if it doesn't exist yet. To update, run `nix flake update debrief` in your dotfiles repo and rebuild.

## Quick start

```sh
debrief init --git git@github.com:you/sessions.git
debrief connect              # install SessionEnd hook
debrief collect              # backfill existing sessions
debrief report --dark        # generate dashboard
```

If using the home-manager module, skip `init` — the archive is already configured.

## Archive types

| Type | Target | Sync mechanism | Auth |
|---|---|---|---|
| Local | `/path/to/dir` | filesystem | none |
| SSH | `user@host:/path` | rsync over SSH | SSH key |
| Git | `--git <repo-url>` | clone + commit + push | existing git auth |

Git archives auto-commit and push on `collect`. No `--commit` flag needed.

## Commands

### `debrief init [dir]`

Bootstrap a new session archive. Creates `machines/`, `facets/`, `.gitignore`, and writes `~/.config/debrief/config.json`.

```sh
debrief init ~/my-sessions                                    # local filesystem
debrief init user@host:~/sessions                             # SSH remote
debrief init --git git@github.com:you/sessions.git            # git repo (default path)
debrief init --git git@github.com:you/sessions.git ~/sessions # git repo (custom path)
```

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
debrief collect --commit       # git commit after sync (filesystem archives only)
```

For git archives, collect always commits and pushes. For SSH archives, `--commit` triggers a remote git commit if the archive is a repo.

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
2. `~/.config/debrief/config.json` (managed by home-manager or `debrief init`)
3. `DEBRIEF_DIR` environment variable
4. If the current directory contains `machines/`, use it
5. `~/.local/share/debrief` as default

## How it works

**Two-layer capture:**

1. **SessionEnd hook** (automatic) — when Claude Code exits, the hook copies the session transcript to your archive
2. **Full sync** (manual/scheduled) — `debrief collect` rsyncs all sessions as a catch-up safety net

For belt-and-suspenders:

```sh
0 */6 * * * debrief collect  # cron sync every 6 hours
```

## License

MIT
