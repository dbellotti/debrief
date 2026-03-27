import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { listJsonl, parseJsonlLines } from "./parsers/common.mjs";
import { parseClaudeSession } from "./parsers/claude.mjs";
import { parseCodexSession } from "./parsers/codex.mjs";

export async function run(opts) {
  const machinesDir = join(opts.archive, "machines");
  const providerFilter = opts.claude ? "claude" : opts.codex ? "codex" : "all";
  const isDark = !!opts.dark;

  const dateStr = new Date().toISOString().slice(0, 10);
  const reportsDir = join(opts.archive, "reports");
  await mkdir(reportsDir, { recursive: true });
  const outputPath = opts.output || join(reportsDir, `report-${dateStr}.html`);

  console.log(`Loading sessions (provider: ${providerFilter})...`);
  const sessions = await loadSessions(machinesDir, providerFilter);
  console.log(`Parsed ${sessions.length} sessions`);

  const html = renderHTML(sessions, providerFilter, isDark);
  await writeFile(outputPath, html, "utf-8");
  console.log(`Report saved to: ${outputPath}`);

  try {
    const { exec } = await import("node:child_process");
    exec(`open "${outputPath}"`);
  } catch {}
}

async function loadSessions(machinesDir, providerFilter) {
  const sessions = [];
  let machineDirs;
  try { machineDirs = await readdir(machinesDir, { withFileTypes: true }); } catch { return []; }
  for (const md of machineDirs) {
    if (!md.isDirectory()) continue;
    const machine = md.name;
    const machineRoot = join(machinesDir, machine);
    if (providerFilter === "all" || providerFilter === "codex") {
      const codexSessions = join(machineRoot, "codex", "sessions");
      if (existsSync(codexSessions)) {
        for (const f of await listJsonl(codexSessions)) {
          try { const lines = parseJsonlLines(await readFile(f, "utf-8")); if (lines.length) sessions.push(parseCodexSession(lines, machine)); } catch {}
        }
      }
    }
    if (providerFilter === "all" || providerFilter === "claude") {
      const claudeProjects = join(machineRoot, "claude", "projects");
      if (existsSync(claudeProjects)) {
        for (const f of await listJsonl(claudeProjects)) {
          if (f.includes("/subagents/")) continue;
          try { const lines = parseJsonlLines(await readFile(f, "utf-8")); if (lines.length) sessions.push(parseClaudeSession(lines, machine)); } catch {}
        }
      }
    }
  }
  return sessions.filter(s => s.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function renderHTML(sessions, providerFilter, isDark) {
  const theme = isDark ? "dark" : "light";
  const sessionsJson = JSON.stringify(sessions);

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session Insights</title>
<style>
:root {
  --bg: #fff; --bg2: #f5f5f5; --fg: #1a1a1a; --fg2: #666; --fg3: #999;
  --border: #e0e0e0; --accent: #4f46e5; --accent2: #7c3aed;
  --green: #16a34a; --orange: #ea580c; --red: #dc2626;
  --heat0: #ebedf0; --heat1: #9be9a8; --heat2: #40c463; --heat3: #30a14e; --heat4: #216e39;
  --line1: #4f46e5; --line2: #f59e0b; --area1: rgba(79,70,229,0.1); --area2: rgba(245,158,11,0.1);
}
[data-theme="dark"] {
  --bg: #0d1117; --bg2: #161b22; --fg: #e6edf3; --fg2: #8b949e; --fg3: #484f58;
  --border: #30363d; --accent: #6366f1; --accent2: #a78bfa;
  --green: #3fb950; --orange: #f0883e; --red: #f85149;
  --heat0: #161b22; --heat1: #0e4429; --heat2: #006d32; --heat3: #26a641; --heat4: #39d353;
  --line1: #818cf8; --line2: #fbbf24; --area1: rgba(129,140,248,0.15); --area2: rgba(251,191,36,0.1);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--fg); line-height: 1.5; padding: 2rem; max-width: 1200px; margin: 0 auto; }
h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
h2 { font-size: 1.1rem; color: var(--fg2); margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
.subtitle { color: var(--fg2); margin-bottom: 1.5rem; }
.filters { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 2rem; padding: 1rem; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; align-items: end; }
.filter-group { display: flex; flex-direction: column; gap: 0.25rem; }
.filter-group label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg2); font-weight: 600; }
.filter-group select, .filter-group input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--fg); font-size: 0.8rem; }
.filter-group select:focus, .filter-group input:focus { outline: 2px solid var(--accent); border-color: var(--accent); }
.filter-reset { padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--fg2); font-size: 0.8rem; cursor: pointer; align-self: end; }
.filter-reset:hover { background: var(--bg2); color: var(--fg); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
.card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; }
.card-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg2); }
.card-value { font-size: 1.75rem; font-weight: 700; }
.card-detail { font-size: 0.8rem; color: var(--fg2); }
.section { margin-bottom: 2.5rem; }
.bar-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem; }
.bar-label { font-size: 0.8rem; width: 140px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.bar-track { flex: 1; height: 18px; background: var(--bg); border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; }
.bar-value { font-size: 0.75rem; color: var(--fg2); width: 130px; flex-shrink: 0; }
.heatmap-grid { display: flex; flex-direction: column; gap: 2px; margin: 1rem 0; width: 100%; }
.heatmap-row { display: flex; gap: 2px; align-items: center; width: 100%; }
.heatmap-dow { font-size: 0.65rem; color: var(--fg2); width: 28px; text-align: right; flex-shrink: 0; }
.heatmap-cell { flex: 1 1 0; aspect-ratio: 1; border-radius: 2px; background: var(--heat0); cursor: default; min-width: 0; }
.heatmap-cell.empty { background: transparent; }
.heatmap-cell.level-1 { background: var(--heat1); }
.heatmap-cell.level-2 { background: var(--heat2); }
.heatmap-cell.level-3 { background: var(--heat3); }
.heatmap-cell.level-4 { background: var(--heat4); }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
@media (max-width: 768px) { .two-col { grid-template-columns: 1fr; } }
.hour-chart { display: flex; align-items: flex-end; gap: 3px; height: 80px; margin: 1rem 0; }
.hour-bar { flex: 1; background: var(--accent); border-radius: 2px 2px 0 0; min-width: 8px; }
.hour-labels { display: flex; justify-content: space-between; font-size: 0.65rem; color: var(--fg2); }
.dow-chart { display: flex; gap: 0.5rem; margin: 1rem 0; }
.dow-item { text-align: center; flex: 1; }
.dow-bar-wrap { height: 60px; display: flex; align-items: flex-end; justify-content: center; }
.dow-bar { width: 24px; background: var(--accent2); border-radius: 3px 3px 0 0; }
.dow-label { font-size: 0.7rem; color: var(--fg2); margin-top: 4px; }
.trend-chart { width: 100%; margin: 1rem 0; }
.trend-chart svg { width: 100%; }
.trend-legend { display: flex; gap: 1.5rem; font-size: 0.75rem; color: var(--fg2); margin-top: 0.5rem; }
.trend-legend-item { display: flex; align-items: center; gap: 4px; }
.trend-legend-dot { width: 10px; height: 3px; border-radius: 2px; }
.session-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
.session-table th, .session-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border); }
.session-table th { font-weight: 600; color: var(--fg2); font-size: 0.7rem; text-transform: uppercase; cursor: pointer; user-select: none; }
.session-table th:hover { color: var(--fg); }
.session-table th .sort-arrow { font-size: 0.6rem; margin-left: 2px; }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.75rem; color: var(--fg2); }
.qual-panel { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 2rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.qual-panel-label { font-size: 0.8rem; color: var(--fg2); flex-shrink: 0; }
.qual-cmd { flex: 1; font-family: monospace; font-size: 0.75rem; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 8px 12px; color: var(--fg); min-width: 0; overflow-x: auto; white-space: nowrap; cursor: text; user-select: all; }
.qual-copy { padding: 6px 14px; border: 1px solid var(--accent); border-radius: 4px; background: var(--accent); color: #fff; font-size: 0.8rem; cursor: pointer; flex-shrink: 0; font-weight: 600; }
.qual-copy:hover { opacity: 0.9; }
</style>
</head>
<body>
<h1>Session Insights</h1>
<p class="subtitle" id="subtitle"></p>

<div class="filters" id="filters"></div>
<div class="qual-panel" id="qual-panel">
  <span class="qual-panel-label">Qualitative Analysis</span>
  <code class="qual-cmd" id="qual-cmd"></code>
  <button class="qual-copy" id="qual-copy">Copy</button>
</div>
<div id="stats-cards" class="grid"></div>
<div class="section"><h2>Trends (Weekly)</h2><div id="trend-chart" class="trend-chart"></div></div>
<div class="section"><h2>Activity</h2><div id="heatmap"></div></div>
<div class="two-col">
  <div class="section"><h2>By Hour of Day</h2><div id="hour-chart" class="hour-chart"></div><div class="hour-labels"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div></div>
  <div class="section"><h2>By Day of Week</h2><div id="dow-chart" class="dow-chart"></div></div>
</div>
<div class="two-col">
  <div class="section"><h2>Top Projects</h2><div id="projects-chart"></div></div>
  <div class="section"><h2>Models</h2><div id="models-chart"></div></div>
</div>
<div class="section" id="tools-section"><h2>Tool Usage</h2><div id="tools-chart"></div></div>
<div class="section" id="provider-section"><h2>By Provider</h2><div id="provider-chart"></div></div>
<div class="section" id="machine-section"><h2>By Machine</h2><div id="machine-chart"></div></div>
<div class="section"><h2>Busiest Days</h2><table class="session-table"><thead><tr><th>Date</th><th>Sessions</th><th>Tokens</th><th>Duration</th></tr></thead><tbody id="busiest-body"></tbody></table></div>
<div class="section"><h2>Recent Sessions</h2><table class="session-table"><thead id="sessions-head"></thead><tbody id="sessions-body"></tbody></table></div>
<footer id="footer"></footer>

<script>
const ALL_SESSIONS = ${sessionsJson};
const INITIAL_PROVIDER = "${providerFilter}";

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function fmt(n) {
  if (n >= 1e9) return (n/1e9).toFixed(1)+"B";
  if (n >= 1e6) return (n/1e6).toFixed(1)+"M";
  if (n >= 1e3) return (n/1e3).toFixed(1)+"K";
  return String(n);
}
function fmtMin(m) {
  if (m < 60) return Math.round(m)+"m";
  const h = Math.floor(m/60), r = Math.round(m%60);
  return r > 0 ? h+"h "+r+"m" : h+"h";
}
function dateStr(iso) { return iso ? iso.slice(0,10) : ""; }
function isoWeek(dateStr) {
  const d = new Date(dateStr+"T00:00:00");
  d.setDate(d.getDate() + 3 - (d.getDay()+6)%7);
  const jan4 = new Date(d.getFullYear(),0,4);
  jan4.setDate(jan4.getDate() + 3 - (jan4.getDay()+6)%7);
  const diff = d - jan4;
  const weekNum = 1 + Math.round(diff / 604800000);
  return d.getFullYear() + "-W" + String(weekNum).padStart(2,"0");
}
function weekStart(weekStr) {
  const [y, w] = weekStr.split("-W").map(Number);
  const jan4 = new Date(y, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const firstMonday = new Date(jan4);
  firstMonday.setDate(jan4.getDate() - dayOfWeek + 1);
  const result = new Date(firstMonday);
  result.setDate(firstMonday.getDate() + (w - 1) * 7);
  return result.toISOString().slice(0,10);
}

// --- Filters ---

function getUniqueValues(sessions, key) {
  return [...new Set(sessions.map(s => s[key]).filter(Boolean))].sort();
}

function buildFilters() {
  const providers = getUniqueValues(ALL_SESSIONS, "provider");
  const projects = getUniqueValues(ALL_SESSIONS, "project");
  const machines = getUniqueValues(ALL_SESSIONS, "machine");
  const models = getUniqueValues(ALL_SESSIONS, "model");
  const dates = ALL_SESSIONS.map(s => dateStr(s.startTime)).filter(Boolean).sort();
  const minDate = dates[0] || "";
  const maxDate = dates[dates.length-1] || "";

  const el = document.getElementById("filters");
  el.innerHTML = \`
    <div class="filter-group">
      <label>Provider</label>
      <select id="f-provider"><option value="">All</option>\${providers.map(p => \`<option value="\${esc(p)}">\${esc(p)}</option>\`).join("")}</select>
    </div>
    <div class="filter-group">
      <label>Project</label>
      <select id="f-project"><option value="">All</option>\${projects.map(p => \`<option value="\${esc(p)}">\${esc(p)}</option>\`).join("")}</select>
    </div>
    <div class="filter-group">
      <label>Machine</label>
      <select id="f-machine"><option value="">All</option>\${machines.map(m => \`<option value="\${esc(m)}">\${esc(m)}</option>\`).join("")}</select>
    </div>
    <div class="filter-group">
      <label>Model</label>
      <select id="f-model"><option value="">All</option>\${models.map(m => \`<option value="\${esc(m)}">\${esc(m)}</option>\`).join("")}</select>
    </div>
    <div class="filter-group">
      <label>From</label>
      <input type="date" id="f-from" value="\${minDate}" min="\${minDate}" max="\${maxDate}">
    </div>
    <div class="filter-group">
      <label>To</label>
      <input type="date" id="f-to" value="\${maxDate}" min="\${minDate}" max="\${maxDate}">
    </div>
    <div class="filter-group">
      <label>Min Duration</label>
      <select id="f-min-duration">
        <option value="0">None</option>
        <option value="1" selected>1 min</option>
        <option value="5">5 min</option>
        <option value="15">15 min</option>
      </select>
    </div>
    <div class="filter-group">
      <label>Min Turns</label>
      <select id="f-min-turns">
        <option value="0">None</option>
        <option value="1" selected>1+</option>
        <option value="3">3+</option>
        <option value="5">5+</option>
      </select>
    </div>
    <button class="filter-reset" id="f-reset">Reset</button>
  \`;
  for (const id of ["f-provider","f-project","f-machine","f-model","f-from","f-to","f-min-duration","f-min-turns"]) {
    document.getElementById(id).addEventListener("change", render);
  }
  document.getElementById("f-reset").addEventListener("click", () => {
    document.getElementById("f-provider").value = "";
    document.getElementById("f-project").value = "";
    document.getElementById("f-machine").value = "";
    document.getElementById("f-model").value = "";
    document.getElementById("f-from").value = minDate;
    document.getElementById("f-to").value = maxDate;
    document.getElementById("f-min-duration").value = "1";
    document.getElementById("f-min-turns").value = "1";
    render();
  });
}

function getFiltered() {
  const prov = document.getElementById("f-provider").value;
  const proj = document.getElementById("f-project").value;
  const mach = document.getElementById("f-machine").value;
  const mod = document.getElementById("f-model").value;
  const from = document.getElementById("f-from").value;
  const to = document.getElementById("f-to").value;
  const minDur = parseFloat(document.getElementById("f-min-duration").value) || 0;
  const minTurns = parseInt(document.getElementById("f-min-turns").value) || 0;
  return ALL_SESSIONS.filter(s => {
    if (prov && s.provider !== prov) return false;
    if (proj && s.project !== proj) return false;
    if (mach && s.machine !== mach) return false;
    if (mod && s.model !== mod) return false;
    const d = dateStr(s.startTime);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (minDur > 0 && s.durationMin < minDur) return false;
    if (minTurns > 0 && s.userMsgCount < minTurns) return false;
    return true;
  });
}

// --- Aggregation ---

function aggregate(sessions) {
  const byDate = {}, byProject = {}, byModel = {}, byMachine = {}, byTool = {}, byProvider = {};
  const byDayOfWeek = [0,0,0,0,0,0,0];
  const byHour = new Array(24).fill(0);
  const byWeek = {};
  let totalTokens = 0, totalDuration = 0, totalUserMsgs = 0;
  for (const s of sessions) {
    const dk = dateStr(s.startTime);
    const dow = new Date(s.startTime).getDay();
    const hr = new Date(s.startTime).getHours();
    const wk = isoWeek(dk);
    byDate[dk] = byDate[dk] || { sessions: 0, tokens: 0, duration: 0 };
    byDate[dk].sessions++; byDate[dk].tokens += s.totalTokens; byDate[dk].duration += s.durationMin;
    byProject[s.project] = byProject[s.project] || { sessions: 0, tokens: 0, duration: 0 };
    byProject[s.project].sessions++; byProject[s.project].tokens += s.totalTokens; byProject[s.project].duration += s.durationMin;
    if (s.model) { byModel[s.model] = byModel[s.model] || { sessions: 0, tokens: 0 }; byModel[s.model].sessions++; byModel[s.model].tokens += s.totalTokens; }
    byMachine[s.machine] = byMachine[s.machine] || { sessions: 0, tokens: 0 }; byMachine[s.machine].sessions++; byMachine[s.machine].tokens += s.totalTokens;
    for (const [t, c] of Object.entries(s.tools)) byTool[t] = (byTool[t]||0) + c;
    byDayOfWeek[dow]++; byHour[hr]++;
    byProvider[s.provider] = byProvider[s.provider] || { sessions: 0, tokens: 0 }; byProvider[s.provider].sessions++; byProvider[s.provider].tokens += s.totalTokens;
    byWeek[wk] = byWeek[wk] || { sessions: 0, tokens: 0, duration: 0 };
    byWeek[wk].sessions++; byWeek[wk].tokens += s.totalTokens; byWeek[wk].duration += s.durationMin;
    totalTokens += s.totalTokens; totalDuration += s.durationMin; totalUserMsgs += s.userMsgCount;
  }
  const sortedDates = Object.keys(byDate).sort();
  let longestStreak = 0, currentStreak = 0, temp = 0;
  if (sortedDates.length) {
    temp = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      if ((new Date(sortedDates[i]) - new Date(sortedDates[i-1])) / 86400000 === 1) temp++;
      else { longestStreak = Math.max(longestStreak, temp); temp = 1; }
    }
    longestStreak = Math.max(longestStreak, temp);
    const today = new Date().toISOString().slice(0,10);
    const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
    if (byDate[today] || byDate[yesterday]) {
      currentStreak = 1;
      const check = byDate[today] ? today : yesterday;
      for (let i = sortedDates.indexOf(check)-1; i >= 0; i--) {
        if ((new Date(sortedDates[i+1]) - new Date(sortedDates[i])) / 86400000 === 1) currentStreak++;
        else break;
      }
    }
  }
  return { total: { sessions: sessions.length, tokens: totalTokens, duration: totalDuration, userMsgs: totalUserMsgs, avgTokensPerSession: sessions.length ? Math.round(totalTokens/sessions.length) : 0, avgDurationMin: sessions.length ? Math.round(totalDuration/sessions.length) : 0 }, byDate, byProject, byModel, byMachine, byTool, byDayOfWeek, byHour, byProvider, byWeek, longestStreak, currentStreak, dateRange: { start: sortedDates[0]||"N/A", end: sortedDates[sortedDates.length-1]||"N/A" } };
}

// --- Renderers ---

function renderCards(agg) {
  document.getElementById("stats-cards").innerHTML = \`
    <div class="card"><div class="card-label">Total Sessions</div><div class="card-value">\${agg.total.sessions}</div><div class="card-detail">\${agg.total.avgDurationMin}m avg duration</div></div>
    <div class="card"><div class="card-label">Total Tokens</div><div class="card-value">\${fmt(agg.total.tokens)}</div><div class="card-detail">\${fmt(agg.total.avgTokensPerSession)} avg/session</div></div>
    <div class="card"><div class="card-label">Total Duration</div><div class="card-value">\${fmtMin(agg.total.duration)}</div><div class="card-detail">\${agg.total.userMsgs} user messages</div></div>
    <div class="card"><div class="card-label">Streaks</div><div class="card-value">\${agg.longestStreak}d longest</div><div class="card-detail">\${agg.currentStreak}d current streak</div></div>
  \`;
}

function renderBarChart(containerId, items, color, maxBars) {
  const sorted = items.sort((a,b) => b.value - a.value).slice(0, maxBars || 15);
  const max = Math.max(...sorted.map(i => i.value), 1);
  document.getElementById(containerId).innerHTML = sorted.map(i => \`
    <div class="bar-row">
      <span class="bar-label">\${esc(i.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:\${(i.value/max)*100}%;background:\${color}"></div></div>
      <span class="bar-value">\${i.display || fmt(i.value)}</span>
    </div>
  \`).join("");
}

function renderHeatmap(byDate) {
  const end = new Date(), start = new Date(end);
  start.setFullYear(start.getFullYear()-1); start.setDate(start.getDate()+1);
  const days = [];
  const d = new Date(start);
  while (d <= end) { days.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); }
  const values = days.map(dk => byDate[dk]?.sessions || 0);
  const maxVal = Math.max(...values, 1);
  const startDow = new Date(days[0]).getDay();
  const cells = new Array(startDow).fill(null).concat(days);
  const weekLabels = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const totalCols = Math.ceil(cells.length / 7);
  let html = '<div class="heatmap-grid">';
  for (let row = 0; row < 7; row++) {
    html += \`<div class="heatmap-row"><span class="heatmap-dow">\${row%2===1?weekLabels[row]:""}</span>\`;
    for (let col = 0; col < totalCols; col++) {
      const idx = col*7+row;
      const dk = idx < cells.length ? cells[idx] : null;
      if (!dk) { html += '<span class="heatmap-cell empty"></span>'; }
      else {
        const val = byDate[dk]?.sessions || 0;
        const level = val === 0 ? 0 : Math.ceil((val/maxVal)*4);
        const tokens = byDate[dk]?.tokens || 0;
        html += \`<span class="heatmap-cell level-\${level}" title="\${dk}: \${val} session(s), \${fmt(tokens)} tokens"></span>\`;
      }
    }
    html += "</div>";
  }
  html += "</div>";
  document.getElementById("heatmap").innerHTML = html;
}

function renderHourChart(byHour) {
  const max = Math.max(...byHour, 1);
  document.getElementById("hour-chart").innerHTML = byHour.map((v,h) =>
    \`<div class="hour-bar" style="height:\${(v/max)*100}%" title="\${h}:00 — \${v} sessions"></div>\`
  ).join("");
}

function renderDowChart(byDow) {
  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const max = Math.max(...byDow, 1);
  document.getElementById("dow-chart").innerHTML = byDow.map((v,i) => \`
    <div class="dow-item">
      <div class="dow-bar-wrap"><div class="dow-bar" style="height:\${(v/max)*100}%"></div></div>
      <div class="dow-label">\${dayNames[i]}</div>
    </div>
  \`).join("");
}

function renderTrendChart(byWeek) {
  const weeks = Object.keys(byWeek).sort();
  if (weeks.length < 2) { document.getElementById("trend-chart").innerHTML = "<p style='color:var(--fg2)'>Not enough data for trends</p>"; return; }

  const allWeeks = [];
  const startW = weeks[0], endW = weeks[weeks.length-1];
  const [sy, sw] = startW.split("-W").map(Number);
  let y = sy, w = sw;
  for (let safety = 0; safety < 200; safety++) {
    const key = y + "-W" + String(w).padStart(2, "0");
    allWeeks.push(key);
    if (key === endW) break;
    w++;
    if (w > 52) {
      const dec28 = new Date(y, 11, 28);
      const maxWeek = Math.ceil(((dec28 - new Date(y, 0, 1)) / 86400000 + new Date(y, 0, 1).getDay() + 1) / 7);
      if (w > maxWeek || w > 53) { w = 1; y++; }
    }
  }

  const tokensData = allWeeks.map(w => byWeek[w]?.tokens || 0);
  const sessionsData = allWeeks.map(w => byWeek[w]?.sessions || 0);
  const maxTokens = Math.max(...tokensData, 1);
  const maxSessions = Math.max(...sessionsData, 1);

  const W = 900, H = 200, padL = 60, padR = 50, padT = 20, padB = 30;
  const cW = W - padL - padR, cH = H - padT - padB;
  const n = allWeeks.length;

  function xPos(i) { return padL + (i / (n-1)) * cW; }
  function yTokens(v) { return padT + cH - (v / maxTokens) * cH; }
  function ySessions(v) { return padT + cH - (v / maxSessions) * cH; }

  const tokensPath = tokensData.map((v,i) => (i===0?"M":"L") + xPos(i).toFixed(1) + "," + yTokens(v).toFixed(1)).join(" ");
  const tokensArea = tokensPath + \` L\${xPos(n-1).toFixed(1)},\${(padT+cH)} L\${padL},\${(padT+cH)} Z\`;
  const sessionsPath = sessionsData.map((v,i) => (i===0?"M":"L") + xPos(i).toFixed(1) + "," + ySessions(v).toFixed(1)).join(" ");

  const tSteps = 4;
  let yLabelsTokens = "";
  for (let i = 0; i <= tSteps; i++) {
    const v = (maxTokens / tSteps) * i;
    const y = yTokens(v);
    yLabelsTokens += \`<text x="\${padL-8}" y="\${y+4}" text-anchor="end" fill="var(--fg2)" font-size="9">\${fmt(v)}</text>\`;
    yLabelsTokens += \`<line x1="\${padL}" y1="\${y}" x2="\${padL+cW}" y2="\${y}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="3,3"/>\`;
  }
  let yLabelsSessions = "";
  for (let i = 0; i <= tSteps; i++) {
    const v = Math.round((maxSessions / tSteps) * i);
    const y = ySessions(v);
    yLabelsSessions += \`<text x="\${padL+cW+8}" y="\${y+4}" text-anchor="start" fill="var(--fg2)" font-size="9">\${v}</text>\`;
  }

  const xStep = Math.max(1, Math.floor(n / 6));
  let xLabels = "";
  for (let i = 0; i < n; i += xStep) {
    const ws = weekStart(allWeeks[i]);
    const label = ws.slice(5);
    xLabels += \`<text x="\${xPos(i)}" y="\${H-4}" text-anchor="middle" fill="var(--fg2)" font-size="9">\${label}</text>\`;
  }

  document.getElementById("trend-chart").innerHTML = \`
    <svg viewBox="0 0 \${W} \${H}" preserveAspectRatio="xMidYMid meet">
      \${yLabelsTokens}
      \${yLabelsSessions}
      \${xLabels}
      <path d="\${tokensArea}" fill="var(--area1)" />
      <path d="\${tokensPath}" fill="none" stroke="var(--line1)" stroke-width="2" />
      <path d="\${sessionsPath}" fill="none" stroke="var(--line2)" stroke-width="2" stroke-dasharray="6,3" />
    </svg>
    <div class="trend-legend">
      <div class="trend-legend-item"><span class="trend-legend-dot" style="background:var(--line1)"></span> Tokens (left axis)</div>
      <div class="trend-legend-item"><span class="trend-legend-dot" style="background:var(--line2)"></span> Sessions (right axis)</div>
    </div>
  \`;
}

function renderSessionsTable(sessions) {
  const recent = sessions.slice(-30).reverse();
  const headEl = document.getElementById("sessions-head");
  headEl.innerHTML = '<tr><th>Date</th><th>Project</th><th>Provider</th><th>Model</th><th>Turns</th><th>Tokens</th><th>Duration</th><th>Machine</th></tr>';
  const bodyEl = document.getElementById("sessions-body");
  function sessionRow(s) {
    return \`<tr>
      <td>\${s.startTime ? s.startTime.slice(0,16).replace("T"," ") : "—"}</td>
      <td>\${esc(s.project)}</td>
      <td>\${esc(s.provider)}</td>
      <td>\${esc(s.model || "—")}</td>
      <td>\${s.userMsgCount}</td>
      <td>\${fmt(s.totalTokens)}</td>
      <td>\${fmtMin(s.durationMin)}</td>
      <td>\${esc(s.machine)}</td>
    </tr>\`;
  }
  bodyEl.innerHTML = recent.map(sessionRow).join("");

  const ths = headEl.querySelectorAll("th");
  const keys = ["startTime","project","provider","model","userMsgCount","totalTokens","durationMin","machine"];
  let sortKey = null, sortAsc = true;
  ths.forEach((th, idx) => {
    th.addEventListener("click", () => {
      const k = keys[idx];
      if (sortKey === k) sortAsc = !sortAsc; else { sortKey = k; sortAsc = false; }
      const sorted = [...recent].sort((a,b) => {
        let av = a[k] ?? "", bv = b[k] ?? "";
        if (typeof av === "number") return sortAsc ? av-bv : bv-av;
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
      bodyEl.innerHTML = sorted.map(sessionRow).join("");
    });
  });
}

function renderBusiestDays(byDate) {
  const top = Object.entries(byDate).sort(([,a],[,b]) => b.tokens - a.tokens).slice(0, 7);
  document.getElementById("busiest-body").innerHTML = top.map(([date, d]) =>
    \`<tr><td>\${date}</td><td>\${d.sessions}</td><td>\${fmt(d.tokens)}</td><td>\${fmtMin(d.duration)}</td></tr>\`
  ).join("");
}

// --- Main render ---

function render() {
  const sessions = getFiltered();
  const agg = aggregate(sessions);

  const providers = [...new Set(sessions.map(s => s.provider))];
  const machines = [...new Set(sessions.map(s => s.machine))];
  const provLabel = providers.length === 1 ? (providers[0] === "codex" ? "Codex" : "Claude Code") : "All Agents";
  document.getElementById("subtitle").textContent = provLabel + " · " + agg.dateRange.start + " to " + agg.dateRange.end + " · " + machines.length + " machine(s) · " + sessions.length + " sessions";

  renderCards(agg);
  renderTrendChart(agg.byWeek);
  renderHeatmap(agg.byDate);
  renderHourChart(agg.byHour);
  renderDowChart(agg.byDayOfWeek);

  renderBarChart("projects-chart",
    Object.entries(agg.byProject).map(([l,d]) => ({ label: l, value: d.tokens, display: fmt(d.tokens)+" tokens" })),
    "var(--accent)", 10);
  renderBarChart("models-chart",
    Object.entries(agg.byModel).map(([l,d]) => ({ label: l, value: d.tokens, display: fmt(d.tokens)+" ("+d.sessions+" sessions)" })),
    "var(--accent2)", 10);

  const toolEntries = Object.entries(agg.byTool);
  const toolsSection = document.getElementById("tools-section");
  if (toolEntries.length) {
    toolsSection.style.display = "";
    renderBarChart("tools-chart", toolEntries.map(([l,v]) => ({ label: l, value: v, display: v+" calls" })), "var(--green)", 15);
  } else toolsSection.style.display = "none";

  const provEntries = Object.entries(agg.byProvider);
  const provSection = document.getElementById("provider-section");
  if (provEntries.length > 1) {
    provSection.style.display = "";
    renderBarChart("provider-chart", provEntries.map(([l,d]) => ({ label: l, value: d.tokens, display: fmt(d.tokens)+" ("+d.sessions+" sessions)" })), "var(--orange)");
  } else provSection.style.display = "none";

  const machEntries = Object.entries(agg.byMachine);
  const machSection = document.getElementById("machine-section");
  if (machEntries.length > 1) {
    machSection.style.display = "";
    renderBarChart("machine-chart", machEntries.map(([l,d]) => ({ label: l, value: d.tokens, display: fmt(d.tokens)+" ("+d.sessions+" sessions)" })), "var(--accent)");
  } else machSection.style.display = "none";

  renderBusiestDays(agg.byDate);
  renderSessionsTable(sessions);

  document.getElementById("footer").textContent = "Generated " + new Date().toISOString().slice(0,19).replace("T"," ") + " by debrief";

  // Build qualitative analysis command
  const parts = ["debrief review"];
  parts.push("--dark");
  const fProj = document.getElementById("f-project").value;
  if (fProj) parts.push("--project " + JSON.stringify(fProj));
  const fMach = document.getElementById("f-machine").value;
  if (fMach) parts.push("--machine " + JSON.stringify(fMach));
  const fFrom = document.getElementById("f-from").value;
  const fTo = document.getElementById("f-to").value;
  if (fFrom) parts.push("--from " + fFrom);
  if (fTo) parts.push("--to " + fTo);
  const fMinDur = document.getElementById("f-min-duration").value;
  if (fMinDur && fMinDur !== "0") parts.push("--min-duration " + (parseFloat(fMinDur) * 60));
  const fMinTurns = document.getElementById("f-min-turns").value;
  if (fMinTurns && fMinTurns !== "0") parts.push("--min-turns " + fMinTurns);
  const cmd = parts.join(" ");
  document.getElementById("qual-cmd").textContent = cmd;
}

document.getElementById("qual-copy").addEventListener("click", () => {
  const cmd = document.getElementById("qual-cmd").textContent;
  navigator.clipboard.writeText(cmd).then(() => {
    const btn = document.getElementById("qual-copy");
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy"; }, 1500);
  });
});

buildFilters();
render();
</script>
</body>
</html>`;
}
