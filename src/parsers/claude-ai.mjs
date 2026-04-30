// Quantitative parse (for report)
export function parseClaudeAiSession(conversation) {
  const id = conversation.uuid || "unknown";
  const project = conversation.project?.name || "";
  const model = conversation.model || "";
  const messages = conversation.chat_messages || [];

  const timestamps = messages
    .filter(m => m.created_at)
    .map(m => new Date(m.created_at));
  const startTime = timestamps.length ? new Date(Math.min(...timestamps)) : null;
  const endTime = timestamps.length ? new Date(Math.max(...timestamps)) : null;
  const durationMin = startTime && endTime ? (endTime - startTime) / 60000 : 0;

  let userMsgCount = 0;
  let agentMsgCount = 0;
  for (const m of messages) {
    if (m.sender === "human") userMsgCount++;
    if (m.sender === "assistant") agentMsgCount++;
  }

  return {
    id,
    machine: null,
    provider: "claude-ai",
    project,
    model,
    cliVersion: null,
    startTime: startTime?.toISOString() || null,
    endTime: endTime?.toISOString() || null,
    durationMin,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    tools: {},
    userMsgCount,
    agentMsgCount,
    eventCount: messages.length,
  };
}

// Qualitative parse (for review)
export function condenseClaudeAi(conversation) {
  const id = conversation.uuid || "unknown";
  const project = conversation.project?.name || "";
  const model = conversation.model || "";
  const messages = conversation.chat_messages || [];
  const turns = [];
  const toolsUsed = {};

  for (const m of messages) {
    if (m.sender === "human") {
      turns.push({ role: "user", text: (m.text || "").slice(0, 500) });
    } else if (m.sender === "assistant") {
      turns.push({ role: "assistant", text: (m.text || "").slice(0, 500) });
    }
  }

  const timestamps = messages.filter(m => m.created_at).map(m => m.created_at);
  const startTime = timestamps[0] || null;
  const endTime = timestamps[timestamps.length - 1] || null;
  const durationSec = startTime && endTime
    ? (new Date(endTime) - new Date(startTime)) / 1000
    : 0;
  const userTurnCount = turns.filter(t => t.role === "user").length;

  return {
    id, project, model, provider: "claude-ai",
    startTime, endTime, durationSec, userTurnCount,
    toolsUsed,
    turns: turns.slice(0, 20),
  };
}
