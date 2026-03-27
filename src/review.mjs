import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listJsonl, parseJsonlLines } from "./parsers/common.mjs";
import { condenseClaude } from "./parsers/claude.mjs";
import { condenseCodex } from "./parsers/codex.mjs";

const execFileAsync = promisify(execFile);

// Prevent non-interactive CLI calls from enqueuing speech
process.env.AGENT_SPEECH_NESTED = "1";

export async function run(opts) {
  const machinesDir = join(opts.archive, "machines");
  const facetsDir = join(opts.archive, "facets");
  const reportsDir = join(opts.archive, "reports");
  const providerFilter = opts.claude ? "claude" : opts.codex ? "codex" : "all";
  const concurrency = opts.concurrency || 5;
  const isDark = !!opts.dark;
  const minDurationSec = (opts.minDuration || 60);
  const minTurns = opts.minTurns || 1;

  // Check for CLI availability
  const haveClaude = await checkCmd("claude");
  const haveCodex = await checkCmd("codex");
  if (!haveClaude && !haveCodex) {
    console.error("Neither 'claude' nor 'codex' CLI found on PATH. At least one is required.");
    process.exit(1);
  }

  console.log("Loading sessions...");
  const sessions = await loadCondensedSessions(machinesDir, providerFilter, minDurationSec, minTurns, opts);
  console.log(`Found ${sessions.length} sessions with conversation data\n`);

  if (sessions.length === 0) {
    console.log("No sessions to analyze.");
    return;
  }

  // Load cached facets
  await mkdir(facetsDir, { recursive: true });
  const cachedIds = new Set();
  try {
    const facetFiles = await readdir(facetsDir);
    for (const f of facetFiles) {
      if (f.endsWith(".json")) cachedIds.add(f.replace(".json", ""));
    }
  } catch {}

  const needsExtraction = sessions.filter(s => !cachedIds.has(s.id));
  const alreadyCached = sessions.length - needsExtraction.length;
  console.log(`Cached: ${alreadyCached}, Need extraction: ${needsExtraction.length}\n`);

  // Extract facets with concurrency
  if (needsExtraction.length > 0) {
    let completed = 0;
    await runWithConcurrency(needsExtraction, concurrency, async (session) => {
      completed++;
      const prefix = `[${completed}/${needsExtraction.length}]`;
      const label = `${session.provider}/${session.project}/${session.id.slice(0, 8)}`;
      process.stdout.write(`${prefix} Extracting: ${label}...`);

      try {
        const facet = await extractFacet(session, haveClaude, haveCodex, facetsDir);
        await writeFile(join(facetsDir, `${session.id}.json`), JSON.stringify(facet, null, 2), "utf-8");
        console.log(` ${facet.outcome} (${facet.session_type})`);
      } catch (e) {
        console.log(` FAILED: ${e.message}`);
      }
    });
    console.log("");
  }

  // Load all facets
  const allFacets = [];
  for (const session of sessions) {
    const facetPath = join(facetsDir, `${session.id}.json`);
    if (existsSync(facetPath)) {
      try {
        allFacets.push(JSON.parse(await readFile(facetPath, "utf-8")));
      } catch {}
    }
  }

  console.log(`Loaded ${allFacets.length} facets for synthesis\n`);

  if (allFacets.length === 0) {
    console.log("No facets to synthesize.");
    return;
  }

  // Synthesize
  let synthesis;
  try {
    synthesis = await synthesize(allFacets);
  } catch (e) {
    console.log("Synthesis failed:", e.message);
    synthesis = "Synthesis could not be generated. Run again to retry.";
  }

  // Render and save
  await mkdir(reportsDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const filterSuffix = [opts.project, opts.machine, opts.from, opts.to].filter(Boolean).join("-").replace(/[^a-zA-Z0-9-]/g, "_");
  const reportName = filterSuffix ? `review-${dateStr}-${filterSuffix}` : `review-${dateStr}`;
  const reportPath = join(reportsDir, `${reportName}.html`);
  const html = renderReport(allFacets, synthesis, isDark);
  await writeFile(reportPath, html, "utf-8");
  console.log(`\nReport saved to: ${reportPath}`);

  try {
    const { exec } = await import("node:child_process");
    exec(`open "${reportPath}"`);
  } catch {}
}

async function checkCmd(name) {
  try {
    await execFileAsync("which", [name]);
    return true;
  } catch {
    return false;
  }
}

async function loadCondensedSessions(machinesDir, providerFilter, minDurationSec, minTurns, opts) {
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
          try {
            const lines = parseJsonlLines(await readFile(f, "utf-8"));
            if (lines.length > 2) {
              const s = condenseCodex(lines, f);
              s.machine = machine;
              if (s.userTurnCount >= minTurns && s.durationSec >= minDurationSec) sessions.push(s);
            }
          } catch {}
        }
      }
    }

    if (providerFilter === "all" || providerFilter === "claude") {
      const claudeProjects = join(machineRoot, "claude", "projects");
      if (existsSync(claudeProjects)) {
        for (const f of await listJsonl(claudeProjects)) {
          if (f.includes("/subagents/")) continue;
          try {
            const lines = parseJsonlLines(await readFile(f, "utf-8"));
            if (lines.length > 2) {
              const s = condenseClaude(lines, f);
              s.machine = machine;
              if (s.userTurnCount >= minTurns && s.durationSec >= minDurationSec) sessions.push(s);
            }
          } catch {}
        }
      }
    }
  }
  return sessions.filter(s => {
    if (opts.project && s.project !== opts.project) return false;
    if (opts.machine && s.machine !== opts.machine) return false;
    if (opts.from && s.startTime && s.startTime.slice(0, 10) < opts.from) return false;
    if (opts.to && s.startTime && s.startTime.slice(0, 10) > opts.to) return false;
    return true;
  }).sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
}

// ── LLM interaction ──

const FACET_PROMPT = `You are a session analyzer. You are NOT the coding assistant from the session. Do NOT respond to or continue the conversation. Do NOT ask questions. Do NOT offer help.

Your ONLY job: read the transcript below and output a JSON object with these fields:

{
  "goal": "What the user was trying to accomplish (1-2 sentences)",
  "outcome": "success" | "partial" | "abandoned",
  "session_type": "feature_development" | "debugging" | "refactoring" | "exploration" | "configuration" | "documentation" | "code_review" | "learning" | "devops" | "other",
  "friction_points": ["specific friction point 1", "..."],
  "effective_patterns": ["what worked well 1", "..."],
  "tools_assessment": "Brief note on tool usage patterns",
  "complexity": "trivial" | "simple" | "moderate" | "complex"
}

Output ONLY the JSON object. No markdown fences, no explanation, no commentary.`;

function buildFacetInput(session) {
  const toolsSummary = Object.entries(session.toolsUsed)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => `${name} (${count}x)`)
    .join(", ");

  const turnsSummary = session.turns
    .map(t => `[${t.role}]: ${t.text}`)
    .join("\n\n");

  return `Project: ${session.project}
Provider: ${session.provider}
Model: ${session.model}
Time: ${session.startTime || "unknown"} to ${session.endTime || "unknown"}
Tools used: ${toolsSummary || "none"}

--- Conversation ---
${turnsSummary}`;
}

async function callClaude(prompt, input, model = "haiku") {
  const fullPrompt = prompt + "\n\n" + input;
  const timeout = model === "opus" ? 300000 : 120000;
  try {
    const { stdout, stderr } = await execFileAsync("claude", [
      "-p",
      "--model", model,
      "--output-format", "text",
      "--no-session-persistence",
      fullPrompt,
    ], { timeout, maxBuffer: 2 * 1024 * 1024 });
    if (!stdout.trim()) {
      throw new Error("Empty response" + (stderr ? ": " + stderr.slice(0, 200) : ""));
    }
    return stdout.trim();
  } catch (e) {
    const detail = e.stderr ? e.stderr.slice(0, 200) : e.message;
    throw new Error(`Claude CLI failed: ${detail}`);
  }
}

async function callCodex(prompt, input, facetsDir) {
  const fullPrompt = prompt + "\n\n" + input;
  const tmpFile = join(facetsDir, `_tmp_codex_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  try {
    const { stderr } = await execFileAsync("codex", [
      "exec",
      "--ephemeral",
      "-o", tmpFile,
      fullPrompt,
    ], { timeout: 120000, maxBuffer: 1024 * 1024 });
    if (!existsSync(tmpFile)) {
      throw new Error("No output file" + (stderr ? ": " + stderr.slice(0, 200) : ""));
    }
    const result = await readFile(tmpFile, "utf-8");
    try { const { unlink } = await import("node:fs/promises"); await unlink(tmpFile); } catch {}
    if (!result.trim()) throw new Error("Empty response");
    return result.trim();
  } catch (e) {
    try { const { unlink } = await import("node:fs/promises"); await unlink(tmpFile); } catch {}
    const detail = e.stderr ? e.stderr.slice(0, 200) : e.message;
    throw new Error(`Codex CLI failed: ${detail}`);
  }
}

async function extractFacet(session, haveClaude, haveCodex, facetsDir) {
  const input = buildFacetInput(session);
  let raw;

  if (session.provider === "codex" && haveCodex) {
    try {
      raw = await callCodex(FACET_PROMPT, input, facetsDir);
    } catch (e) {
      console.log(`  Codex CLI failed for ${session.id.slice(0, 8)}, falling back to Claude: ${e.message}`);
      if (haveClaude) {
        raw = await callClaude(FACET_PROMPT, input);
      } else throw e;
    }
  } else if (haveClaude) {
    raw = await callClaude(FACET_PROMPT, input);
  } else {
    throw new Error("No CLI available for provider: " + session.provider);
  }

  raw = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const facet = JSON.parse(raw);
    return {
      session_id: session.id,
      provider: session.provider,
      project: session.project,
      model: session.model,
      machine: session.machine,
      startTime: session.startTime,
      endTime: session.endTime,
      goal: facet.goal || "Unknown",
      outcome: facet.outcome || "unknown",
      session_type: facet.session_type || "other",
      friction_points: Array.isArray(facet.friction_points) ? facet.friction_points : [],
      effective_patterns: Array.isArray(facet.effective_patterns) ? facet.effective_patterns : [],
      tools_assessment: facet.tools_assessment || "",
      complexity: facet.complexity || "unknown",
      extracted_at: new Date().toISOString(),
    };
  } catch {
    console.log(`  Warning: Could not parse facet JSON for ${session.id.slice(0, 8)}, raw: ${raw.slice(0, 200)}`);
    return {
      session_id: session.id,
      provider: session.provider,
      project: session.project,
      model: session.model,
      machine: session.machine,
      startTime: session.startTime,
      endTime: session.endTime,
      goal: "Could not extract",
      outcome: "unknown",
      session_type: "other",
      friction_points: [],
      effective_patterns: [],
      tools_assessment: "",
      complexity: "unknown",
      raw_response: raw.slice(0, 500),
      extracted_at: new Date().toISOString(),
    };
  }
}

const SYNTHESIS_PROMPT = `You are analyzing a collection of coding session facets from a developer who uses AI coding assistants (Claude Code, Codex, etc.).

Given the facets below, produce a structured qualitative analysis. Be specific and actionable — reference concrete projects, tools, and patterns from the data.

Write your analysis in markdown with these EXACT section headers (## level). Include ALL sections even if a section has limited data.

## At a Glance
Write exactly 4 subsections using these bold prefixes on separate lines:
**What's working:** 1-2 sentences on effective patterns and workflows.
**What's hindering:** 1-2 sentences on the top friction and blockers.
**Quick wins:** 1-2 sentences on immediate improvements to try.
**Looking ahead:** 1-2 sentences on aspirational or emerging workflows.

## What's Working Well
Bulleted list of effective workflows and patterns. For each, explain why it's effective and which projects or sessions demonstrate it.

## Friction Points
Ranked list of the most impactful friction points. For each, use this structure:
### [Friction title] ([count] sessions, [severity] impact)
Description of the friction, which projects/tools it affects, a concrete example from the sessions, and a suggested mitigation.

## Configuration Suggestions
Suggest specific lines to add to the user's CLAUDE.md or AGENTS.md files that would prevent recurring friction or reinforce effective patterns. For each suggestion, use this EXACT format separated by blank lines:

SUGGESTION: the exact text to add to the config file
FILE: CLAUDE.md or AGENTS.md
WHERE: which section it belongs in (e.g., "## Communication Style", "## Development Workflow")
WHY: rationale referencing specific session friction or patterns

## Automation Opportunities
Concrete hooks, skills, aliases, or scripts to reduce repetitive work. For each, describe:
- What it does
- Which recurring pattern it addresses (with session evidence)
- Implementation sketch (command, config snippet, or pseudocode)

## Cross-Tool Comparison
Compare how different AI tools performed across these sessions. Where does each excel? Where does each struggle? Reference specific session examples. If only one provider is present, analyze that provider's strengths and weaknesses across different task types.

## Project Insights
Brief observations about each active project — what work is happening, momentum, patterns, and risks worth noting.

## Recommendations
Top 3-5 actionable recommendations ranked by impact. For each, state the recommendation, the evidence supporting it, and the expected benefit.`;

async function synthesize(facets) {
  const facetsSummary = facets.map(f => {
    return `[${f.provider}] ${f.project} (${f.startTime?.slice(0, 10) || "?"}) — ${f.goal || "?"}
  Outcome: ${f.outcome}, Type: ${f.session_type}, Complexity: ${f.complexity}
  Friction: ${(f.friction_points || []).join("; ") || "none"}
  Effective: ${(f.effective_patterns || []).join("; ") || "none"}
  Tools: ${f.tools_assessment || "none"}`;
  }).join("\n\n");

  const input = `Total sessions analyzed: ${facets.length}
Providers: ${[...new Set(facets.map(f => f.provider))].join(", ")}
Projects: ${[...new Set(facets.map(f => f.project))].join(", ")}
Date range: ${facets[0]?.startTime?.slice(0, 10) || "?"} to ${facets[facets.length - 1]?.startTime?.slice(0, 10) || "?"}

--- Session Facets ---
${facetsSummary}`;

  console.log("Running synthesis with Opus (this may take a moment)...");
  return await callClaude(SYNTHESIS_PROMPT, input, "opus");
}

// ── Concurrency helper ──

async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── HTML rendering ──

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function markdownToHtml(md) {
  const escaped = escapeHtml(md);
  const lines = escaped.split("\n");
  const out = [];
  let inList = false;
  let inCodeBlock = false;
  let codeBlockLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.match(/^`{3}/)) {
      if (inCodeBlock) {
        if (inList) { out.push("</ul>"); inList = false; }
        out.push("<pre><code>" + codeBlockLines.join("\n") + "</code></pre>");
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        if (inList) { out.push("</ul>"); inList = false; }
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    if (!trimmed) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("");
      continue;
    }
    const h3 = trimmed.match(/^### (.+)$/);
    if (h3) { if (inList) { out.push("</ul>"); inList = false; } out.push("<h3>" + h3[1] + "</h3>"); continue; }
    const h2 = trimmed.match(/^## (.+)$/);
    if (h2) { if (inList) { out.push("</ul>"); inList = false; } out.push("<h2>" + h2[1] + "</h2>"); continue; }
    const h1 = trimmed.match(/^# (.+)$/);
    if (h1) { if (inList) { out.push("</ul>"); inList = false; } out.push("<h1>" + h1[1] + "</h1>"); continue; }
    const li = trimmed.match(/^[-*] (.+)$/) || trimmed.match(/^\d+\. (.+)$/);
    if (li) { if (!inList) { out.push("<ul>"); inList = true; } out.push("<li>" + li[1] + "</li>"); continue; }
    if (/^---+$/.test(trimmed)) { if (inList) { out.push("</ul>"); inList = false; } continue; }
    if (inList) { out.push("</ul>"); inList = false; }
    out.push(trimmed);
  }
  if (inList) out.push("</ul>");
  if (inCodeBlock && codeBlockLines.length) {
    out.push("<pre><code>" + codeBlockLines.join("\n") + "</code></pre>");
  }

  let html = "";
  let inPara = false;
  for (const line of out) {
    if (!line) { if (inPara) { html += "</p>"; inPara = false; } continue; }
    if (line.startsWith("<h") || line.startsWith("<ul") || line.startsWith("</ul") || line.startsWith("<li") || line.startsWith("<pre")) {
      if (inPara) { html += "</p>"; inPara = false; }
      html += line;
    } else {
      if (!inPara) { html += "<p>"; inPara = true; } else { html += " "; }
      html += line;
    }
  }
  if (inPara) html += "</p>";

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  return html;
}

function parseSections(markdown) {
  const sections = {};
  const parts = markdown.split(/^## /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nlIdx = part.indexOf("\n");
    if (nlIdx === -1) continue;
    const title = part.slice(0, nlIdx).trim();
    const content = part.slice(nlIdx + 1).trim();
    sections[title] = content;
  }
  return sections;
}

function parseConfigSuggestions(sectionText) {
  if (!sectionText) return [];
  const suggestions = [];
  const parts = sectionText.split(/^SUGGESTION:\s*/m).filter(p => p.trim());
  for (const part of parts) {
    const lines = part.split("\n");
    let suggestion = "", file = "", where = "", why = "";
    let currentField = "suggestion";
    for (const line of lines) {
      const fileMatch = line.match(/^FILE:\s*(.+)/);
      const whereMatch = line.match(/^WHERE:\s*(.+)/);
      const whyMatch = line.match(/^WHY:\s*(.+)/);
      if (fileMatch) { file = fileMatch[1].trim(); currentField = "file"; }
      else if (whereMatch) { where = whereMatch[1].trim(); currentField = "where"; }
      else if (whyMatch) { why = whyMatch[1].trim(); currentField = "why"; }
      else if (currentField === "suggestion" && line.trim()) {
        suggestion += (suggestion ? " " : "") + line.trim();
      } else if (currentField === "why" && line.trim()) {
        why += " " + line.trim();
      }
    }
    if (suggestion) {
      suggestions.push({
        suggestion: suggestion.replace(/^`+|`+$/g, ""),
        file: file || "CLAUDE.md",
        where: where.replace(/^`+|`+$/g, ""),
        why: why.trim(),
      });
    }
  }
  return suggestions;
}

function parseAtAGlance(sectionText) {
  if (!sectionText) return {};
  const result = {};
  const patterns = [
    [/\*\*What's working:\*\*\s*(.+?)(?=\n\*\*|\n*$)/s, "working"],
    [/\*\*What's hindering:\*\*\s*(.+?)(?=\n\*\*|\n*$)/s, "hindering"],
    [/\*\*Quick wins:\*\*\s*(.+?)(?=\n\*\*|\n*$)/s, "quickWins"],
    [/\*\*Looking ahead:\*\*\s*(.+?)(?=\n\*\*|\n*$)/s, "lookingAhead"],
  ];
  for (const [re, key] of patterns) {
    const m = sectionText.match(re);
    if (m) result[key] = m[1].trim();
  }
  return result;
}

function renderReport(facets, synthesis, isDark) {
  const theme = isDark ? "dark" : "light";
  const dateStr = new Date().toISOString().slice(0, 10);
  const sections = parseSections(synthesis);
  const glance = parseAtAGlance(sections["At a Glance"]);
  const configSuggestions = parseConfigSuggestions(sections["Configuration Suggestions"]);

  const outcomeCount = {};
  const typeCount = {};
  const complexityCount = {};
  const frictionAll = [];
  const patternAll = [];
  const projects = new Set();
  const models = new Set();
  const providers = new Set();
  for (const f of facets) {
    outcomeCount[f.outcome] = (outcomeCount[f.outcome] || 0) + 1;
    typeCount[f.session_type] = (typeCount[f.session_type] || 0) + 1;
    complexityCount[f.complexity] = (complexityCount[f.complexity] || 0) + 1;
    for (const fp of (f.friction_points || [])) frictionAll.push(fp);
    for (const ep of (f.effective_patterns || [])) patternAll.push(ep);
    if (f.project) projects.add(f.project);
    if (f.model) models.add(f.model);
    if (f.provider) providers.add(f.provider);
  }

  const dateRange = `${facets[0]?.startTime?.slice(0, 10) || "?"} to ${facets[facets.length - 1]?.startTime?.slice(0, 10) || "?"}`;
  const projectList = [...projects].join(", ");
  const modelList = [...models].map(m => m.split("/").pop().split("-").slice(0, 3).join("-")).join(", ");
  const providerList = [...providers].join(", ");

  function barChart(title, data, color) {
    const sorted = Object.entries(data).sort(([, a], [, b]) => b - a);
    if (!sorted.length) return "";
    const max = sorted[0][1] || 1;
    const bars = sorted.map(([label, count]) => {
      const displayLabel = label.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      return `<div class="bar-row"><div class="bar-label">${escapeHtml(displayLabel)}</div><div class="bar-track"><div class="bar-fill" style="width:${(count / max) * 100}%;background:${color}"></div></div><div class="bar-value">${count}</div></div>`;
    }).join("\n");
    return `<div class="chart-card"><div class="chart-title">${escapeHtml(title)}</div>${bars}</div>`;
  }

  const configHtml = configSuggestions.length > 0 ? configSuggestions.map((s, i) => {
    const displayText = escapeHtml(s.suggestion).replace(/\\n/g, "\n");
    const copyText = s.suggestion.replace(/\\n/g, "\n");
    return `
    <div class="config-item">
      <input type="checkbox" id="cfg-${i}" class="cfg-checkbox" checked data-text="${escapeHtml(copyText)}">
      <label for="cfg-${i}" class="config-label">
        <div class="config-main">
          <code class="config-code">${displayText}</code>
          <button class="copy-btn" onclick="copyCfgItem(${i})">Copy</button>
        </div>
        <div class="config-meta">
          <span class="config-file">${escapeHtml(s.file)}</span>
          ${s.where ? `<span class="config-where">${escapeHtml(s.where)}</span>` : ""}
        </div>
        ${s.why ? `<div class="config-why">${escapeHtml(s.why)}</div>` : ""}
      </label>
    </div>
  `;
  }).join("") : '<p class="empty">No specific suggestions generated.</p>';

  const facetRows = facets.map(f => `
    <tr>
      <td>${f.startTime?.slice(0, 10) || "?"}</td>
      <td><span class="badge ${escapeHtml(f.provider)}">${escapeHtml(f.provider)}</span></td>
      <td>${escapeHtml(f.project)}</td>
      <td class="goal-cell">${escapeHtml(f.goal || "?")}</td>
      <td><span class="outcome-${escapeHtml(f.outcome)}">${escapeHtml(f.outcome)}</span></td>
      <td>${escapeHtml((f.session_type || "").replace(/_/g, " "))}</td>
      <td>${escapeHtml(f.complexity)}</td>
      <td>${(f.friction_points || []).length}</td>
    </tr>
  `).join("");

  function renderSection(key, fallback) {
    const content = sections[key];
    if (!content) return fallback || "";
    return `<div class="narrative">${markdownToHtml(content)}</div>`;
  }

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Qualitative Insights - ${dateStr}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f8fafc; --bg2: white; --fg: #334155; --fg2: #64748b; --fg3: #0f172a;
    --border: #e2e8f0; --accent: #4f46e5;
    --green: #16a34a; --orange: #ea580c; --red: #dc2626;
    --glance-bg1: #fef3c7; --glance-bg2: #fde68a; --glance-border: #f59e0b;
    --glance-title: #92400e; --glance-text: #78350f; --glance-link: #b45309;
    --win-bg: #f0fdf4; --win-border: #bbf7d0; --win-title: #166534; --win-text: #15803d;
    --friction-bg: #fef2f2; --friction-border: #fca5a5; --friction-title: #991b1b; --friction-text: #7f1d1d;
    --config-bg: #eff6ff; --config-border: #bfdbfe; --config-title: #1e40af;
    --config-code-bg: white; --config-code-border: #bfdbfe;
    --auto-bg: #f5f3ff; --auto-border: #c4b5fd; --auto-title: #5b21b6; --auto-text: #6b21a8;
    --narrative-bg: white; --chart-track: #f1f5f9;
  }
  [data-theme="dark"] {
    --bg: #0f172a; --bg2: #1e293b; --fg: #e2e8f0; --fg2: #94a3b8; --fg3: #f1f5f9;
    --border: #334155; --accent: #818cf8;
    --green: #4ade80; --orange: #fb923c; --red: #f87171;
    --glance-bg1: #451a03; --glance-bg2: #78350f; --glance-border: #b45309;
    --glance-title: #fde68a; --glance-text: #fef3c7; --glance-link: #fbbf24;
    --win-bg: #052e16; --win-border: #166534; --win-title: #86efac; --win-text: #bbf7d0;
    --friction-bg: #450a0a; --friction-border: #991b1b; --friction-title: #fca5a5; --friction-text: #fecaca;
    --config-bg: #1e1b4b; --config-border: #3730a3; --config-title: #a5b4fc;
    --config-code-bg: #0f172a; --config-code-border: #3730a3;
    --auto-bg: #2e1065; --auto-border: #6d28d9; --auto-title: #c4b5fd; --auto-text: #ddd6fe;
    --narrative-bg: #1e293b; --chart-track: #334155;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.65; padding: 48px 24px; }
  .container { max-width: 800px; margin: 0 auto; }
  h1 { font-size: 32px; font-weight: 700; color: var(--fg3); margin-bottom: 8px; }
  h2 { font-size: 20px; font-weight: 600; color: var(--fg3); margin-top: 48px; margin-bottom: 16px; }
  h3 { font-size: 15px; font-weight: 600; margin: 16px 0 8px; }
  .subtitle { color: var(--fg2); font-size: 15px; margin-bottom: 8px; }
  .meta-line { color: var(--fg2); font-size: 13px; margin-bottom: 4px; }
  .meta-line strong { color: var(--fg); }
  .nav-toc { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 32px; padding: 16px; background: var(--bg2); border-radius: 8px; border: 1px solid var(--border); }
  .nav-toc a { font-size: 12px; color: var(--fg2); text-decoration: none; padding: 6px 12px; border-radius: 6px; background: var(--bg); transition: all 0.15s; }
  .nav-toc a:hover { background: var(--border); color: var(--fg3); }
  .stats-row { display: flex; gap: 24px; margin-bottom: 40px; padding: 20px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .stat { text-align: center; }
  .stat-value { font-size: 24px; font-weight: 700; color: var(--fg3); }
  .stat-label { font-size: 11px; color: var(--fg2); text-transform: uppercase; }
  .at-a-glance { background: linear-gradient(135deg, var(--glance-bg1) 0%, var(--glance-bg2) 100%); border: 1px solid var(--glance-border); border-radius: 12px; padding: 20px 24px; margin-bottom: 32px; }
  .glance-title { font-size: 16px; font-weight: 700; color: var(--glance-title); margin-bottom: 16px; }
  .glance-sections { display: flex; flex-direction: column; gap: 12px; }
  .glance-section { font-size: 14px; color: var(--glance-text); line-height: 1.6; }
  .glance-section strong { color: var(--glance-title); }
  .see-more { color: var(--glance-link); text-decoration: none; font-size: 13px; white-space: nowrap; }
  .see-more:hover { text-decoration: underline; }
  .narrative { background: var(--narrative-bg); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 24px; }
  .narrative p { margin-bottom: 12px; font-size: 14px; color: var(--fg); line-height: 1.7; }
  .narrative ul { padding-left: 1.5rem; margin: 0.5rem 0; }
  .narrative li { margin-bottom: 0.35rem; font-size: 14px; line-height: 1.6; }
  .narrative h2 { font-size: 16px; margin-top: 20px; margin-bottom: 10px; color: var(--fg3); }
  .narrative h3 { font-size: 14px; margin-top: 16px; margin-bottom: 8px; color: var(--fg3); }
  .narrative code { background: var(--bg); padding: 1px 5px; border-radius: 3px; font-size: 0.85em; }
  .narrative strong { color: var(--fg3); }
  .section-intro { font-size: 14px; color: var(--fg2); margin-bottom: 16px; }
  .win-card { background: var(--win-bg); border: 1px solid var(--win-border); border-radius: 8px; padding: 20px; margin-bottom: 24px; }
  .win-card p { color: var(--win-text); font-size: 14px; line-height: 1.7; margin-bottom: 8px; }
  .win-card ul { padding-left: 1.5rem; margin: 0.5rem 0; }
  .win-card li { color: var(--win-text); font-size: 14px; margin-bottom: 6px; line-height: 1.6; }
  .win-card strong { color: var(--win-title); }
  .friction-card { background: var(--friction-bg); border: 1px solid var(--friction-border); border-radius: 8px; padding: 20px; margin-bottom: 24px; }
  .friction-card p { color: var(--friction-text); font-size: 14px; line-height: 1.7; margin-bottom: 8px; }
  .friction-card h3 { color: var(--friction-title); font-size: 15px; margin-bottom: 8px; }
  .friction-card ul { padding-left: 1.5rem; margin: 0.5rem 0; }
  .friction-card li { color: var(--friction-text); font-size: 13px; margin-bottom: 4px; }
  .friction-card strong { color: var(--friction-title); }
  .config-section { background: var(--config-bg); border: 1px solid var(--config-border); border-radius: 8px; padding: 16px; margin-bottom: 24px; }
  .config-section h3 { font-size: 14px; font-weight: 600; color: var(--config-title); margin: 0 0 12px; }
  .config-actions { margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--config-border); }
  .copy-all-btn { background: #2563eb; color: white; border: none; border-radius: 4px; padding: 6px 12px; font-size: 12px; cursor: pointer; font-weight: 500; transition: all 0.2s; }
  .copy-all-btn:hover { background: #1d4ed8; }
  .copy-all-btn.copied { background: var(--green); }
  .config-item { display: flex; align-items: flex-start; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--config-border); }
  .config-item:last-child { border-bottom: none; }
  .cfg-checkbox { margin-top: 4px; }
  .config-label { flex: 1; }
  .config-main { display: flex; align-items: flex-start; gap: 8px; }
  .config-code { background: var(--config-code-bg); padding: 8px 12px; border-radius: 4px; font-size: 12px; color: var(--config-title); border: 1px solid var(--config-code-border); font-family: monospace; display: block; white-space: pre-wrap; word-break: break-word; flex: 1; }
  .config-meta { display: flex; gap: 8px; margin-top: 6px; }
  .config-file { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 3px; background: var(--config-border); color: var(--config-title); }
  .config-where { font-size: 11px; color: var(--fg2); }
  .config-why { font-size: 12px; color: var(--fg2); margin-top: 4px; }
  .copy-btn { background: var(--border); border: none; border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; color: var(--fg2); flex-shrink: 0; }
  .copy-btn:hover { background: var(--fg2); color: var(--bg); }
  .auto-card { background: var(--auto-bg); border: 1px solid var(--auto-border); border-radius: 8px; padding: 20px; margin-bottom: 24px; }
  .auto-card p { color: var(--auto-text); font-size: 14px; line-height: 1.7; margin-bottom: 8px; }
  .auto-card ul { padding-left: 1.5rem; margin: 0.5rem 0; }
  .auto-card li { color: var(--auto-text); font-size: 14px; margin-bottom: 6px; line-height: 1.6; }
  .auto-card h3 { color: var(--auto-title); }
  .auto-card strong { color: var(--auto-title); }
  .auto-card code { background: rgba(255,255,255,0.2); padding: 1px 5px; border-radius: 3px; font-size: 0.85em; }
  pre { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; margin: 12px 0; overflow-x: auto; }
  pre code { background: none; padding: 0; border: none; font-size: 12px; color: var(--fg); white-space: pre-wrap; word-break: break-word; display: block; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; line-height: 1.5; }
  .charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
  .chart-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .chart-title { font-size: 12px; font-weight: 600; color: var(--fg2); text-transform: uppercase; margin-bottom: 12px; }
  .bar-row { display: flex; align-items: center; margin-bottom: 6px; }
  .bar-label { width: 120px; font-size: 11px; color: var(--fg2); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { flex: 1; height: 6px; background: var(--chart-track); border-radius: 3px; margin: 0 8px; }
  .bar-fill { height: 100%; border-radius: 3px; }
  .bar-value { width: 28px; font-size: 11px; font-weight: 500; color: var(--fg2); text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin: 1rem 0; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border); }
  th { font-weight: 600; color: var(--fg2); font-size: 0.7rem; text-transform: uppercase; }
  .goal-cell { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 0.7rem; font-weight: 600; }
  .badge.claude { background: #dbeafe; color: #1d4ed8; }
  .badge.codex { background: #fce7f3; color: #be185d; }
  [data-theme="dark"] .badge.claude { background: #1e3a5f; color: #93c5fd; }
  [data-theme="dark"] .badge.codex { background: #4a1942; color: #f9a8d4; }
  .outcome-success { color: var(--green); font-weight: 600; }
  .outcome-partial { color: var(--orange); font-weight: 600; }
  .outcome-abandoned { color: var(--red); font-weight: 600; }
  .outcome-unknown { color: var(--fg2); }
  .collapsible-header { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 12px 0; border-bottom: 1px solid var(--border); user-select: none; }
  .collapsible-header h2 { margin: 0; font-size: 20px; }
  .collapsible-arrow { font-size: 12px; color: var(--fg2); transition: transform 0.2s; }
  .collapsible-content { display: none; padding-top: 16px; }
  .collapsible-content.open { display: block; }
  .collapsible-header.open .collapsible-arrow { transform: rotate(90deg); }
  .empty { color: var(--fg2); font-size: 13px; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.75rem; color: var(--fg2); }
  @media (max-width: 640px) { .charts-row { grid-template-columns: 1fr; } .stats-row { justify-content: center; } }
</style>
</head>
<body>
<div class="container">
  <h1>Qualitative Insights</h1>
  <p class="subtitle">${facets.length} sessions analyzed &middot; ${dateRange}</p>
  <p class="meta-line"><strong>Projects:</strong> ${escapeHtml(projectList)}</p>
  <p class="meta-line"><strong>Providers:</strong> ${escapeHtml(providerList)}</p>
  <p class="meta-line"><strong>Models:</strong> ${escapeHtml(modelList)}</p>
  <p class="meta-line" style="margin-bottom:24px"><strong>Synthesis:</strong> Opus</p>

  ${glance.working || glance.hindering ? `
  <div class="at-a-glance">
    <div class="glance-title">At a Glance</div>
    <div class="glance-sections">
      ${glance.working ? `<div class="glance-section"><strong>What's working:</strong> ${escapeHtml(glance.working)} <a href="#section-wins" class="see-more">See details &rarr;</a></div>` : ""}
      ${glance.hindering ? `<div class="glance-section"><strong>What's hindering:</strong> ${escapeHtml(glance.hindering)} <a href="#section-friction" class="see-more">See details &rarr;</a></div>` : ""}
      ${glance.quickWins ? `<div class="glance-section"><strong>Quick wins:</strong> ${escapeHtml(glance.quickWins)} <a href="#section-config" class="see-more">See details &rarr;</a></div>` : ""}
      ${glance.lookingAhead ? `<div class="glance-section"><strong>Looking ahead:</strong> ${escapeHtml(glance.lookingAhead)} <a href="#section-recommendations" class="see-more">See details &rarr;</a></div>` : ""}
    </div>
  </div>
  ` : ""}

  <nav class="nav-toc">
    <a href="#section-wins">What's Working</a>
    <a href="#section-friction">Friction Points</a>
    <a href="#section-config">Config Suggestions</a>
    <a href="#section-automation">Automation</a>
    <a href="#section-comparison">Cross-Tool</a>
    <a href="#section-projects">Projects</a>
    <a href="#section-recommendations">Recommendations</a>
    <a href="#section-facets">Session Facets</a>
  </nav>

  <div class="stats-row">
    <div class="stat"><div class="stat-value">${facets.length}</div><div class="stat-label">Sessions</div></div>
    <div class="stat"><div class="stat-value" style="color:var(--green)">${outcomeCount.success || 0}</div><div class="stat-label">Success</div></div>
    <div class="stat"><div class="stat-value" style="color:var(--orange)">${outcomeCount.partial || 0}</div><div class="stat-label">Partial</div></div>
    <div class="stat"><div class="stat-value" style="color:var(--red)">${outcomeCount.abandoned || 0}</div><div class="stat-label">Abandoned</div></div>
    <div class="stat"><div class="stat-value">${frictionAll.length}</div><div class="stat-label">Friction Pts</div></div>
    <div class="stat"><div class="stat-value">${patternAll.length}</div><div class="stat-label">Effective Patterns</div></div>
  </div>

  <h2 id="section-wins">What's Working Well</h2>
  <div class="win-card">
    ${sections["What's Working Well"] ? markdownToHtml(sections["What's Working Well"]) : '<p class="empty">No data.</p>'}
  </div>

  <h2 id="section-friction">Friction Points</h2>
  <div class="friction-card">
    ${sections["Friction Points"] ? markdownToHtml(sections["Friction Points"]) : '<p class="empty">No data.</p>'}
  </div>

  <div class="charts-row">
    ${barChart("Outcomes", outcomeCount, "var(--accent)")}
    ${barChart("Session Types", typeCount, "#8b5cf6")}
  </div>
  <div class="charts-row">
    ${barChart("Complexity", complexityCount, "#0891b2")}
    ${frictionAll.length > 0 ? (() => {
      const frictionCats = {};
      for (const fp of frictionAll) {
        const lower = fp.toLowerCase();
        const cat = lower.includes("bug") || lower.includes("error") || lower.includes("wrong") ? "Buggy Output"
          : lower.includes("scope") || lower.includes("over") || lower.includes("complex") ? "Scope Creep"
          : lower.includes("misunderst") || lower.includes("wrong approach") ? "Misunderstood Intent"
          : lower.includes("tool") || lower.includes("cli") || lower.includes("command") ? "Tooling Issues"
          : "Other";
        frictionCats[cat] = (frictionCats[cat] || 0) + 1;
      }
      return barChart("Friction Categories", frictionCats, "#dc2626");
    })() : ""}
  </div>

  <h2 id="section-config">Configuration Suggestions</h2>
  <div class="config-section">
    <h3>Suggested CLAUDE.md / AGENTS.md Additions</h3>
    <p style="font-size:12px;color:var(--fg2);margin-bottom:12px">Copy individual items or use the button to copy all checked suggestions.</p>
    <div class="config-actions">
      <button class="copy-all-btn" onclick="copyAllChecked()">Copy All Checked</button>
    </div>
    ${configHtml}
  </div>

  <h2 id="section-automation">Automation Opportunities</h2>
  <div class="auto-card">
    ${sections["Automation Opportunities"] ? markdownToHtml(sections["Automation Opportunities"]) : '<p class="empty">No data.</p>'}
  </div>

  <h2 id="section-comparison">Cross-Tool Comparison</h2>
  ${renderSection("Cross-Tool Comparison")}

  <h2 id="section-projects">Project Insights</h2>
  ${renderSection("Project Insights")}

  <h2 id="section-recommendations">Recommendations</h2>
  ${renderSection("Recommendations")}

  <div class="collapsible-header" onclick="toggleCollapsible(this)">
    <span class="collapsible-arrow">&#9654;</span>
    <h2 id="section-facets" style="margin:0">Session Facets (${facets.length})</h2>
  </div>
  <div class="collapsible-content">
    <table>
      <thead><tr><th>Date</th><th>Agent</th><th>Project</th><th>Goal</th><th>Outcome</th><th>Type</th><th>Complexity</th><th>Friction</th></tr></thead>
      <tbody>${facetRows}</tbody>
    </table>
  </div>

  <footer>Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")} by debrief &middot; Synthesis by Opus</footer>
</div>

<script>
function toggleCollapsible(header) {
  header.classList.toggle('open');
  header.nextElementSibling.classList.toggle('open');
}
function copyCfgItem(idx) {
  const cb = document.getElementById('cfg-' + idx);
  if (!cb) return;
  navigator.clipboard.writeText(cb.dataset.text).then(() => {
    const btn = cb.closest('.config-item').querySelector('.copy-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 2000); }
  });
}
function copyAllChecked() {
  const checked = document.querySelectorAll('.cfg-checkbox:checked');
  const texts = [];
  checked.forEach(cb => { if (cb.dataset.text) texts.push(cb.dataset.text); });
  const btn = document.querySelector('.copy-all-btn');
  navigator.clipboard.writeText(texts.join('\\n\\n')).then(() => {
    btn.textContent = 'Copied ' + texts.length + ' items!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy All Checked'; btn.classList.remove('copied'); }, 2000);
  });
}
</script>
</body>
</html>`;
}
