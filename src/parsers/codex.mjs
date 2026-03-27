import { idFromFilename } from "./common.mjs";

// Quantitative parse (for report)
export function parseCodexSession(lines, machine) {
  const meta = lines.find(l => l.type === "session_meta");
  const payload = meta?.payload || {};
  const id = payload.id || "unknown";
  const cwd = payload.cwd || "";
  const project = cwd.split("/").pop() || cwd;
  const cliVersion = payload.cli_version || "";
  let model = "";
  let totalTokens = 0, inputTokens = 0, outputTokens = 0, reasoningTokens = 0, cachedTokens = 0;
  const tools = {};
  let userMsgCount = 0, agentMsgCount = 0;
  const timestamps = lines.filter(l => l.timestamp).map(l => new Date(l.timestamp));
  const startTime = timestamps.length ? new Date(Math.min(...timestamps)) : null;
  const endTime = timestamps.length ? new Date(Math.max(...timestamps)) : null;
  const durationMin = startTime && endTime ? (endTime - startTime) / 60000 : 0;
  for (const line of lines) {
    if (line.type === "turn_context" && line.payload?.model) model = line.payload.model;
    if (line.type === "event_msg" && line.payload?.type === "token_count") {
      const tu = line.payload.info?.total_token_usage;
      if (tu) { totalTokens = tu.total_tokens||0; inputTokens = tu.input_tokens||0; outputTokens = tu.output_tokens||0; reasoningTokens = tu.reasoning_output_tokens||0; cachedTokens = tu.cached_input_tokens||0; }
    }
    if (line.type === "response_item" && line.payload?.type === "function_call") { const n = line.payload.name||"unknown"; tools[n] = (tools[n]||0)+1; }
    if (line.type === "event_msg" && line.payload?.type === "user_message") userMsgCount++;
    if (line.type === "event_msg" && line.payload?.type === "agent_message") agentMsgCount++;
  }
  return { id, machine, provider: "codex", project, model, cliVersion, startTime: startTime?.toISOString()||null, endTime: endTime?.toISOString()||null, durationMin, totalTokens, inputTokens, outputTokens, reasoningTokens, cachedTokens, tools, userMsgCount, agentMsgCount, eventCount: lines.length };
}

// Qualitative parse (for review)
export function condenseCodex(lines, filepath) {
  const meta = lines.find(l => l.type === "session_meta");
  const payload = meta?.payload || {};
  const id = idFromFilename(filepath) || payload.id || "unknown";
  const cwd = payload.cwd || "";
  const project = cwd.split("/").pop() || cwd;
  let model = "";
  const turns = [];
  const toolsUsed = {};

  for (const line of lines) {
    if (line.type === "turn_context" && line.payload?.model) model = line.payload.model;
    if (line.type === "event_msg" && line.payload?.type === "user_message" && line.payload.message) {
      turns.push({ role: "user", text: line.payload.message.slice(0, 500) });
    }
    if (line.type === "event_msg" && line.payload?.type === "agent_message" && line.payload.message) {
      turns.push({ role: "assistant", text: line.payload.message.slice(0, 500) });
    }
    if (line.type === "response_item" && line.payload?.type === "function_call") {
      const name = line.payload.name || "unknown";
      toolsUsed[name] = (toolsUsed[name] || 0) + 1;
    }
  }

  const timestamps = lines.filter(l => l.timestamp).map(l => l.timestamp);
  const startTime = timestamps[0] || null;
  const endTime = timestamps[timestamps.length - 1] || null;
  const durationSec = startTime && endTime ? (new Date(endTime) - new Date(startTime)) / 1000 : 0;
  const userTurnCount = turns.filter(t => t.role === "user").length;
  return {
    id, project, model, provider: "codex",
    startTime, endTime, durationSec, userTurnCount,
    toolsUsed,
    turns: turns.slice(0, 20),
  };
}
