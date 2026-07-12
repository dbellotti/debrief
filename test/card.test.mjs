import { test } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  localDateKey,
  buildDailyTotals,
  quartileThresholds,
  levelFor,
  buildGrid,
  renderCard,
  run,
  fmt,
  longestStreak,
  windowStats,
} from "../src/card.mjs";

// 2026-07-08 is a Wednesday
const END = new Date(2026, 6, 8);

test("buildDailyTotals groups sessions by local day and sums tokens", () => {
  const day1 = new Date(2026, 0, 15, 9).toISOString();
  const day1b = new Date(2026, 0, 15, 22).toISOString();
  const day2 = new Date(2026, 0, 16, 12).toISOString();
  const byDate = buildDailyTotals([
    { startTime: day1, totalTokens: 100 },
    { startTime: day1b, totalTokens: 50 },
    { startTime: day2, totalTokens: 7 },
  ]);
  const k1 = localDateKey(new Date(day1));
  const k2 = localDateKey(new Date(day2));
  assert.deepStrictEqual(byDate[k1], { sessions: 2, tokens: 150 });
  assert.deepStrictEqual(byDate[k2], { sessions: 1, tokens: 7 });
});

test("buildDailyTotals exposes only sessions and tokens", () => {
  const byDate = buildDailyTotals([
    { startTime: new Date(2026, 0, 15).toISOString(), totalTokens: 5, project: "secret-client", machine: "workhost" },
  ]);
  for (const day of Object.values(byDate)) {
    assert.deepStrictEqual(Object.keys(day).sort(), ["sessions", "tokens"]);
  }
});

test("quartile levels spread a heavy-tailed distribution", () => {
  const values = [100, 200, 300, 400, 500, 600, 700, 5_000_000];
  const thresholds = quartileThresholds(values);
  const levels = values.map(v => levelFor(v, thresholds));
  assert.strictEqual(levels[levels.length - 1], 4);
  assert.ok(levels.includes(1) && levels.includes(2) && levels.includes(3),
    `heavy tail should not crush lower levels, got ${levels}`);
});

test("levelFor maps zero to level 0 and quartile bands to 1-4", () => {
  const thresholds = quartileThresholds([10, 20, 30, 40]);
  assert.strictEqual(levelFor(0, thresholds), 0);
  assert.strictEqual(levelFor(10, thresholds), 1);
  assert.strictEqual(levelFor(40, thresholds), 4);
  const all = [10, 20, 30, 40].map(v => levelFor(v, thresholds));
  assert.deepStrictEqual([...new Set(all)].sort(), [1, 2, 3, 4]);
});

test("buildGrid covers trailing 12 months in Sunday-aligned weeks", () => {
  const { weeks } = buildGrid(END);
  assert.ok(weeks.length >= 52 && weeks.length <= 54, `got ${weeks.length} weeks`);
  // first cell is a Sunday on/before end - 364 days
  const first = new Date(weeks[0][0]);
  assert.strictEqual(first.getUTCDay(), 0);
  const windowStart = new Date(END);
  windowStart.setDate(windowStart.getDate() - 364);
  assert.ok(first <= windowStart);
  // last non-null cell is endDate; cells after it are null
  const lastWeek = weeks[weeks.length - 1];
  assert.strictEqual(lastWeek[3], localDateKey(END)); // Wednesday = row 3
  assert.deepStrictEqual(lastWeek.slice(4), [null, null, null]);
  // days are contiguous
  const days = weeks.flat().filter(Boolean);
  for (let i = 1; i < days.length; i++) {
    const diff = new Date(days[i]) - new Date(days[i - 1]);
    assert.strictEqual(diff, 86_400_000, `gap between ${days[i - 1]} and ${days[i]}`);
  }
});

test("buildGrid labels month starts without duplicates", () => {
  const { monthLabels } = buildGrid(END);
  assert.ok(monthLabels.length >= 10 && monthLabels.length <= 12, `got ${monthLabels.length} labels`);
  const cols = monthLabels.map(m => m.col);
  assert.deepStrictEqual(cols, [...cols].sort((a, b) => a - b));
  for (let i = 1; i < monthLabels.length; i++) {
    assert.ok(cols[i] - cols[i - 1] >= 3, "labels should be at least a few weeks apart");
  }
});

test("renderCard produces a self-contained SVG with GitHub-style geometry", () => {
  const byDate = { [localDateKey(END)]: { sessions: 2, tokens: 1000 } };
  const svg = renderCard({ byDate, endDate: END });

  assert.ok(svg.startsWith("<svg"));
  assert.ok(!svg.includes("<script"), "no JavaScript");
  assert.ok(!/href|url\(|@import/.test(svg), "no external references");

  const { weeks } = buildGrid(END);
  const cellCount = weeks.flat().filter(Boolean).length;
  const rects = svg.match(/<rect /g) || [];
  assert.strictEqual(rects.length, cellCount, "one rect per day, none for future days");

  assert.ok(svg.includes('width="11" height="11" rx="2"'), "11px cells with 2px corner radius");
  assert.ok(svg.includes(">Mon</text>") && svg.includes(">Wed</text>") && svg.includes(">Fri</text>"));
  assert.ok(/>(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)<\/text>/.test(svg), "month labels present");
  assert.ok(svg.includes('aria-label="LLM usage heatmap, trailing 12 months"'));
  assert.ok(!svg.includes("<rect x=\"0\""), "no background rect — transparent");
});

test("renderCard colors the active day and leaves others empty", () => {
  const activeKey = localDateKey(END);
  const byDate = { [activeKey]: { sessions: 1, tokens: 500 } };
  const svg = renderCard({ byDate, endDate: END });
  const fills = [...svg.matchAll(/<rect[^>]*fill="(#[0-9a-f]{6})"/g)].map(m => m[1]);
  const nonEmpty = fills.filter(f => f !== "#ebedf0");
  assert.strictEqual(nonEmpty.length, 1, "exactly one colored cell");
  // with a single nonzero day, all quartile thresholds equal its value → level 1
  assert.strictEqual(nonEmpty[0], "#c7d2fe");
});

test("renderCard selects the palette for the requested theme", () => {
  const byDate = { [localDateKey(END)]: { sessions: 1, tokens: 500 } };
  const light = renderCard({ byDate, endDate: END, theme: "light" });
  const dark = renderCard({ byDate, endDate: END, theme: "dark" });

  // Dark uses its own empty/active cells and label color; none of the light hexes leak.
  assert.ok(dark.includes('fill="#161b22"'), "dark empty cell");
  assert.ok(dark.includes('fill="#1e1b4b"'), "dark level-1 cell");
  assert.ok(dark.includes('fill="#8b949e"'), "dark label color");
  for (const lightHex of ["#ebedf0", "#c7d2fe", "#59636e"]) {
    assert.ok(!dark.includes(lightHex), `dark must not contain light hex ${lightHex}`);
  }
  assert.ok(light.includes('fill="#ebedf0"') && light.includes('fill="#c7d2fe"'));
});

test("both themes share identical geometry and data, differing only in color", () => {
  const byDate = { [localDateKey(END)]: { sessions: 1, tokens: 500 } };
  const strip = svg => svg.replace(/fill="#[0-9a-f]{6}"/g, 'fill="X"');
  const light = renderCard({ byDate, endDate: END, theme: "light" });
  const dark = renderCard({ byDate, endDate: END, theme: "dark" });
  assert.strictEqual(strip(light), strip(dark), "only fill colors should differ");
  assert.notStrictEqual(light, dark, "colors must actually differ");
});

test("run emits both themed variants into --out-dir with transparent backgrounds", async (t) => {
  const configHome = await mkdtemp(join(tmpdir(), "debrief-cfg-"));
  const archive = await mkdtemp(join(tmpdir(), "debrief-arch-"));
  const outDir = await mkdtemp(join(tmpdir(), "debrief-out-"));
  await mkdir(join(archive, "machines"), { recursive: true });
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome; // isolate from the real user config
  t.after(async () => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prev;
    await rm(configHome, { recursive: true, force: true });
    await rm(archive, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  await run({ archive, outDir });

  const lightPath = join(outDir, "usage-light.svg");
  const darkPath = join(outDir, "usage-dark.svg");
  assert.ok(existsSync(lightPath), "usage-light.svg written");
  assert.ok(existsSync(darkPath), "usage-dark.svg written");

  const light = await readFile(lightPath, "utf-8");
  const dark = await readFile(darkPath, "utf-8");
  assert.ok(light.includes('fill="#ebedf0"'), "light palette in light file");
  assert.ok(dark.includes('fill="#161b22"'), "dark palette in dark file");
  for (const svg of [light, dark]) {
    assert.ok(!svg.includes('<rect x="0"'), "no background rect — transparent");
  }
});

test("run with -o writes only the light variant to the exact path", async (t) => {
  const configHome = await mkdtemp(join(tmpdir(), "debrief-cfg-"));
  const archive = await mkdtemp(join(tmpdir(), "debrief-arch-"));
  const outDir = await mkdtemp(join(tmpdir(), "debrief-out-"));
  await mkdir(join(archive, "machines"), { recursive: true });
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;
  t.after(async () => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prev;
    await rm(configHome, { recursive: true, force: true });
    await rm(archive, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  const output = join(outDir, "card.svg");
  await run({ archive, output });

  assert.ok(existsSync(output), "wrote to the exact -o path");
  assert.ok(!existsSync(join(outDir, "usage-light.svg")), "no default light file");
  assert.ok(!existsSync(join(outDir, "usage-dark.svg")), "no dark file with -o");
  const svg = await readFile(output, "utf-8");
  assert.ok(svg.includes('fill="#ebedf0"'), "light palette");
  assert.ok(!svg.includes('fill="#161b22"'), "not dark palette");
});

test("fmt renders compact token counts", () => {
  assert.strictEqual(fmt(950), "950");
  assert.strictEqual(fmt(12_300), "12.3k");
  assert.strictEqual(fmt(4_500_000), "4.5M");
  assert.strictEqual(fmt(1_200_000_000), "1.2B");
});

test("longestStreak finds the longest contiguous run", () => {
  assert.strictEqual(longestStreak([]), 0);
  assert.strictEqual(longestStreak(["2026-01-01"]), 1);
  // two runs: Jan 1-3 (3) and Jan 10-11 (2); order-independent
  assert.strictEqual(
    longestStreak(["2026-01-11", "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-10"]),
    3,
  );
  // run spanning a month boundary is contiguous
  assert.strictEqual(longestStreak(["2026-01-30", "2026-01-31", "2026-02-01"]), 3);
});

test("windowStats aggregates only over the given window days", () => {
  const byDate = {
    "2026-07-06": { sessions: 2, tokens: 100 },
    "2026-07-07": { sessions: 1, tokens: 50 },
    "2026-07-08": { sessions: 3, tokens: 900 },
    "2026-01-01": { sessions: 9, tokens: 9999 }, // outside the window
  };
  const stats = windowStats(byDate, ["2026-07-06", "2026-07-07", "2026-07-08"]);
  assert.strictEqual(stats.sessions, 6);
  assert.strictEqual(stats.tokens, 1050);
  assert.strictEqual(stats.activeDays, 3);
  assert.strictEqual(stats.longestStreak, 3);
  assert.strictEqual(stats.start, "2026-07-06");
  assert.strictEqual(stats.end, "2026-07-08");
});

test("windowStats streak respects gaps within the window", () => {
  const byDate = {
    "2026-07-01": { sessions: 1, tokens: 10 },
    "2026-07-02": { sessions: 1, tokens: 10 },
    // gap on 07-03
    "2026-07-04": { sessions: 1, tokens: 10 },
  };
  const days = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"];
  const stats = windowStats(byDate, days);
  assert.strictEqual(stats.activeDays, 3);
  assert.strictEqual(stats.longestStreak, 2);
});

test("renderCard adds a headline strip and freshness stamp", () => {
  const byDate = {
    [localDateKey(END)]: { sessions: 3, tokens: 12_300 },
    [localDateKey(new Date(2026, 6, 7))]: { sessions: 1, tokens: 400 },
  };
  const svg = renderCard({ byDate, endDate: END });
  assert.ok(svg.includes("4 sessions"), "total sessions in strip");
  assert.ok(svg.includes("12.7k tokens"), "total tokens formatted in strip");
  assert.ok(svg.includes("2 active days"), "active-day count in strip");
  assert.ok(/\dd streak/.test(svg), "longest streak in strip");
  assert.ok(svg.includes(`updated ${localDateKey(END)}`), "freshness stamp reflects endDate");
  // window range spans the rendered cells
  const { weeks } = buildGrid(END);
  const days = weeks.flat().filter(Boolean);
  assert.ok(svg.includes(`${days[0]} – ${days[days.length - 1]}`), "window date range");
});

test("renderCard gives every nonzero cell a native title, zero cells none", () => {
  const byDate = { [localDateKey(END)]: { sessions: 2, tokens: 1000 } };
  const svg = renderCard({ byDate, endDate: END });
  const titles = svg.match(/<title>/g) || [];
  assert.strictEqual(titles.length, 1, "one title per nonzero cell");
  assert.ok(
    svg.includes(`<title>${localDateKey(END)}: 2 sessions, 1000 tokens</title>`),
    "title carries date, session count, token count",
  );
  // title lives inside a non-self-closing rect
  assert.ok(/<rect[^>]*><title>[^<]*<\/title><\/rect>/.test(svg));
  // singular session wording
  const svg1 = renderCard({ byDate: { [localDateKey(END)]: { sessions: 1, tokens: 5 } }, endDate: END });
  assert.ok(svg1.includes("1 session,"), "singular 'session' for a single-session day");
  // still self-contained
  assert.ok(!svg.includes("<script") && !/href|url\(|@import/.test(svg));
});
