import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { withArchive } from "./archive.mjs";
import { loadSessionFiles } from "./sessions.mjs";
import { parse } from "./parsers/registry.mjs";

// Public usage card: a contribution-style heatmap SVG for embedding outside
// the archive (e.g. a GitHub profile README). This renderer is narrow by
// construction — it consumes only per-day session/token totals, so project
// names, machine names, and session content have no path into the output.

const CELL = 11, GAP = 3, PITCH = CELL + GAP;
const LEFT = 30, TOP = 16;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const PALETTES = {
  light: { levels: ["#ebedf0", "#c7d2fe", "#818cf8", "#4f46e5", "#312e81"], label: "#59636e" },
  dark: { levels: ["#161b22", "#1e1b4b", "#3730a3", "#6366f1", "#a5b4fc"], label: "#8b949e" },
};

export function localDateKey(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Reduce parsed sessions to per-day totals. Reads only startTime and totalTokens. */
export function buildDailyTotals(sessions) {
  const byDate = {};
  for (const s of sessions) {
    const dk = localDateKey(new Date(s.startTime));
    byDate[dk] = byDate[dk] || { sessions: 0, tokens: 0 };
    byDate[dk].sessions++;
    byDate[dk].tokens += s.totalTokens || 0;
  }
  return byDate;
}

/** Quartile thresholds (q25, q50, q75) via linear interpolation. */
export function quartileThresholds(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return [0, 0, 0];
  const q = p => {
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  return [q(0.25), q(0.5), q(0.75)];
}

export function levelFor(tokens, [t1, t2, t3]) {
  if (!tokens) return 0;
  if (tokens > t3) return 4;
  if (tokens > t2) return 3;
  if (tokens > t1) return 2;
  return 1;
}

/** Compact token count, e.g. 950, 12.3k, 4.5M, 1.2B. */
export function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

/** Longest run of consecutive calendar days among the given date keys. */
export function longestStreak(dateKeys) {
  const sorted = [...dateKeys].sort();
  let longest = 0, run = 0, prev = null;
  for (const dk of sorted) {
    run = prev && (new Date(dk) - new Date(prev)) / 86400000 === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = dk;
  }
  return longest;
}

/** Non-identifying aggregates over the rendered window (sorted day keys). */
export function windowStats(byDate, dayKeys) {
  let sessions = 0, tokens = 0;
  const active = [];
  for (const dk of dayKeys) {
    const d = byDate[dk];
    if (d && d.sessions > 0) { sessions += d.sessions; tokens += d.tokens; active.push(dk); }
  }
  return {
    sessions, tokens,
    activeDays: active.length,
    longestStreak: longestStreak(active),
    start: dayKeys[0], end: dayKeys[dayKeys.length - 1],
  };
}

/**
 * Trailing-12-month grid ending at endDate, GitHub-style: columns are
 * Sunday-to-Saturday weeks, starting at the Sunday on/before one year back.
 * Cells after endDate are null. Returns { weeks, monthLabels }.
 */
export function buildGrid(endDate) {
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const windowStart = new Date(end);
  windowStart.setDate(windowStart.getDate() - 364);
  const gridStart = new Date(windowStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const weeks = [];
  const cursor = new Date(gridStart);
  while (cursor <= end) {
    const week = [];
    for (let dow = 0; dow < 7; dow++) {
      week.push(cursor <= end ? localDateKey(cursor) : null);
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  const monthLabels = [];
  for (let i = 1; i < weeks.length - 2; i++) {
    const month = new Date(weeks[i][0]).getUTCMonth();
    const prev = new Date(weeks[i - 1][0]).getUTCMonth();
    if (month !== prev) monthLabels.push({ col: i, label: MONTHS[month] });
  }
  return { weeks, monthLabels };
}

/** Render the heatmap card as a self-contained static SVG string. */
export function renderCard({ byDate, endDate, theme = "light" }) {
  const palette = PALETTES[theme];
  const { weeks, monthLabels } = buildGrid(endDate);

  const cellDays = weeks.flat().filter(Boolean);
  const nonzero = cellDays.map(dk => byDate[dk]?.tokens || 0).filter(t => t > 0);
  const thresholds = quartileThresholds(nonzero);

  const width = LEFT + weeks.length * PITCH - GAP;
  const gridBottom = TOP + 7 * PITCH - GAP;
  const stripY = gridBottom + 16;
  const height = stripY + 8;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="LLM usage heatmap, trailing 12 months">`);
  parts.push(`<g font-family="${FONT}" font-size="10" fill="${palette.label}">`);
  for (const { col, label } of monthLabels) {
    parts.push(`<text x="${LEFT + col * PITCH}" y="10">${label}</text>`);
  }
  for (const [row, label] of [[1, "Mon"], [3, "Wed"], [5, "Fri"]]) {
    parts.push(`<text x="${LEFT - 6}" y="${TOP + row * PITCH + 9}" text-anchor="end">${label}</text>`);
  }
  parts.push(`</g>`);

  for (let col = 0; col < weeks.length; col++) {
    for (let row = 0; row < 7; row++) {
      const dk = weeks[col][row];
      if (!dk) continue;
      const d = byDate[dk];
      const tokens = d?.tokens || 0;
      const level = levelFor(tokens, thresholds);
      const rect = `<rect x="${LEFT + col * PITCH}" y="${TOP + row * PITCH}" width="${CELL}" height="${CELL}" rx="2" fill="${palette.levels[level]}"`;
      if (tokens > 0) {
        const s = d.sessions;
        parts.push(`${rect}><title>${dk}: ${s} session${s === 1 ? "" : "s"}, ${d.tokens} tokens</title></rect>`);
      } else {
        parts.push(`${rect}/>`);
      }
    }
  }

  const stats = windowStats(byDate, cellDays);
  const headline = `${stats.sessions} sessions · ${fmt(stats.tokens)} tokens · ${stats.activeDays} active days · ${stats.longestStreak}d streak · ${stats.start} – ${stats.end}`;
  parts.push(`<g font-family="${FONT}" font-size="10" fill="${palette.label}">`);
  parts.push(`<text x="${LEFT}" y="${stripY}">${headline}</text>`);
  parts.push(`<text x="${width}" y="${stripY}" text-anchor="end">updated ${localDateKey(endDate)}</text>`);
  parts.push(`</g>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

export async function run(opts) {
  await withArchive(opts.archive, ["machines", "cloud"], async ({ localPath }) => {
    const tuples = await loadSessionFiles(localPath);
    const sessions = tuples.map(t => { try { return parse(t); } catch { return null; } }).filter(s => s && s.startTime);
    const byDate = buildDailyTotals(sessions);
    const endDate = new Date();

    // -o writes only the light variant to an exact path (backward compat).
    // Otherwise emit both themed variants into --out-dir (default: cwd).
    if (opts.output) {
      await writeFile(opts.output, renderCard({ byDate, endDate, theme: "light" }), "utf-8");
      console.log(`Card saved to: ${opts.output}`);
      return;
    }
    const dir = opts.outDir || process.cwd();
    await mkdir(dir, { recursive: true });
    for (const theme of ["light", "dark"]) {
      const outputPath = resolve(dir, `usage-${theme}.svg`);
      await writeFile(outputPath, renderCard({ byDate, endDate, theme }), "utf-8");
      console.log(`Card saved to: ${outputPath}`);
    }
  });
}
