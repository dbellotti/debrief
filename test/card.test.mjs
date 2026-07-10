import { test } from "node:test";
import assert from "node:assert";
import {
  localDateKey,
  buildDailyTotals,
  quartileThresholds,
  levelFor,
  buildGrid,
  renderCard,
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
  const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"\/>/g)].map(m => m[1]);
  const nonEmpty = fills.filter(f => f !== "#ebedf0");
  assert.strictEqual(nonEmpty.length, 1, "exactly one colored cell");
  // with a single nonzero day, all quartile thresholds equal its value → level 1
  assert.strictEqual(nonEmpty[0], "#c7d2fe");
});
