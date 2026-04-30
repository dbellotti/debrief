import { idFromFilename } from "./common.mjs";

// Quantitative parse (for report)
export function parseClaudeSession(lines, machine) {
  const first = lines[0] || {};
  const id = first.sessionId || first.uuid || "unknown";
  const cwd = first.cwd || "";
  const project = cwd.split("/").pop() || cwd;
  const version = first.version || "";
  let model = "";
  let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheCreation = 0;
  const tools = {};
  let userMsgCount = 0, assistantMsgCount = 0;
  const timestamps = lines.filter(l => l.timestamp).map(l => new Date(l.timestamp));
  const startTime = timestamps.length ? new Date(Math.min(...timestamps)) : null;
  const endTime = timestamps.length ? new Date(Math.max(...timestamps)) : null;
  const durationMin = startTime && endTime ? (endTime - startTime) / 60000 : 0;
  for (const line of lines) {
    if (line.message?.model) model = line.message.model;
    if (line.message?.usage) { const u = line.message.usage; inputTokens += u.input_tokens||0; outputTokens += u.output_tokens||0; cacheRead += u.cache_read_input_tokens||0; cacheCreation += u.cache_creation_input_tokens||0; }
    if (line.type === "user" && !line.isMeta) userMsgCount++;
    if (line.type === "assistant") {
      assistantMsgCount++;
      const content = line.message?.content;
      if (Array.isArray(content)) for (const b of content) if (b.type === "tool_use") { const n = b.name||"unknown"; tools[n] = (tools[n]||0)+1; }
    }
  }
  const totalTokens = inputTokens + outputTokens + cacheRead + cacheCreation;
  return { id, machine, provider: "claude", project, model, cliVersion: version, startTime: startTime?.toISOString()||null, endTime: endTime?.toISOString()||null, durationMin, totalTokens, inputTokens, outputTokens, reasoningTokens: 0, cachedTokens: cacheRead + cacheCreation, tools, userMsgCount, agentMsgCount: assistantMsgCount, eventCount: lines.length };
}

// Qualitative parse (for review)
export function condenseClaude(lines, filepath) {
  const first = lines[0] || {};
  const id = idFromFilename(filepath) || first.sessionId || first.uuid || "unknown";
  const cwd = first.cwd || "";
  const project = cwd.split("/").pop() || cwd;
  let model = "";
  const turns = [];
  const toolsUsed = {};

  for (const line of lines) {
    if (line.message?.model) model = line.message.model;
    if (line.type === "user" && !line.isMeta) {
      const content = line.message?.content;
      if (typeof content === "string" && content.trim() && !content.startsWith("<command-")) {
        turns.push({ role: "user", text: content.slice(0, 500) });
      }
    }
    if (line.type === "assistant") {
      const content = line.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            turns.push({ role: "assistant", text: block.text.slice(0, 500) });
          }
          if (block.type === "tool_use") {
            toolsUsed[block.name] = (toolsUsed[block.name] || 0) + 1;
          }
        }
      }
    }
  }

  const timestamps = lines.filter(l => l.timestamp).map(l => l.timestamp);
  const startTime = timestamps[0] || null;
  const endTime = timestamps[timestamps.length - 1] || null;
  const durationSec = startTime && endTime ? (new Date(endTime) - new Date(startTime)) / 1000 : 0;
  const userTurnCount = turns.filter(t => t.role === "user").length;
  return {
    id, project, model, provider: "claude",
    startTime, endTime, durationSec, userTurnCount,
    toolsUsed,
    turns: turns.slice(0, 20),
  };
}
