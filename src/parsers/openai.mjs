// Walk the active branch (current_node -> root) for the canonical message order;
// fall back to sorting all mapping nodes by create_time.
function orderedMessages(conversation) {
  const mapping = conversation.mapping || {};
  const chain = [];
  const seen = new Set();
  let nodeId = conversation.current_node;
  while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node = mapping[nodeId];
    if (node.message) chain.push(node.message);
    nodeId = node.parent;
  }
  if (chain.length) return chain.reverse();
  return Object.values(mapping)
    .map(n => n.message)
    .filter(Boolean)
    .sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
}

function messageText(message) {
  const parts = message.content?.parts || [];
  return parts.filter(p => typeof p === "string").join("");
}

// User/assistant messages a person would see in the ChatGPT UI: skips system,
// tool, hidden, tool-directed (recipient != "all"), and empty messages.
function visibleMessages(conversation) {
  return orderedMessages(conversation).filter(m => {
    const role = m.author?.role;
    if (role !== "user" && role !== "assistant") return false;
    if (m.metadata?.is_visually_hidden_from_conversation) return false;
    if (m.recipient && m.recipient !== "all") return false;
    return messageText(m).length > 0;
  });
}

function extractModel(conversation, messages) {
  if (conversation.default_model_slug) return conversation.default_model_slug;
  const assistant = messages.find(m => m.author?.role === "assistant" && m.metadata?.model_slug);
  return assistant?.metadata.model_slug || "";
}

// Quantitative parse (for report)
export function parseOpenAiSession(conversation) {
  const id = conversation.conversation_id || conversation.id || "unknown";
  const messages = visibleMessages(conversation);
  const model = extractModel(conversation, messages);

  const timestamps = messages
    .filter(m => m.create_time)
    .map(m => new Date(m.create_time * 1000));
  const startTime = timestamps.length ? new Date(Math.min(...timestamps)) : null;
  const endTime = timestamps.length ? new Date(Math.max(...timestamps)) : null;
  const durationMin = startTime && endTime ? (endTime - startTime) / 60000 : 0;

  let userMsgCount = 0;
  let agentMsgCount = 0;
  for (const m of messages) {
    if (m.author.role === "user") userMsgCount++;
    if (m.author.role === "assistant") agentMsgCount++;
  }

  return {
    id,
    machine: null,
    provider: "openai",
    project: "",
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
export function condenseOpenAi(conversation) {
  const id = conversation.conversation_id || conversation.id || "unknown";
  const messages = visibleMessages(conversation);
  const model = extractModel(conversation, messages);
  const turns = [];
  const toolsUsed = {};

  for (const m of messages) {
    const role = m.author.role === "user" ? "user" : "assistant";
    turns.push({ role, text: messageText(m).slice(0, 500) });
  }

  const timestamps = messages
    .filter(m => m.create_time)
    .map(m => new Date(m.create_time * 1000).toISOString());
  const startTime = timestamps[0] || null;
  const endTime = timestamps[timestamps.length - 1] || null;
  const durationSec = startTime && endTime
    ? (new Date(endTime) - new Date(startTime)) / 1000
    : 0;
  const userTurnCount = turns.filter(t => t.role === "user").length;

  return {
    id, project: "", model, provider: "openai",
    startTime, endTime, durationSec, userTurnCount,
    toolsUsed,
    turns: turns.slice(0, 20),
  };
}
