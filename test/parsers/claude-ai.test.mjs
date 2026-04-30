import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeAiSession, condenseClaudeAi } from "../../src/parsers/claude-ai.mjs";

// Realistic fixture matching the claude.ai GET conversation response shape
const CONVERSATION = {
  uuid: "abc-123-def",
  name: "Debug flaky test",
  created_at: "2025-06-01T10:00:00.000Z",
  updated_at: "2025-06-01T10:25:00.000Z",
  model: "claude-sonnet-4-5-20250514",
  project_uuid: "proj-456",
  project: { uuid: "proj-456", name: "debrief" },
  chat_messages: [
    {
      uuid: "msg-1",
      text: "Why is my test flaky?",
      sender: "human",
      index: 0,
      created_at: "2025-06-01T10:00:00.000Z",
      updated_at: "2025-06-01T10:00:00.000Z",
    },
    {
      uuid: "msg-2",
      text: "The test is flaky because it depends on timing. Here is a fix...",
      sender: "assistant",
      index: 1,
      created_at: "2025-06-01T10:01:00.000Z",
      updated_at: "2025-06-01T10:01:00.000Z",
    },
    {
      uuid: "msg-3",
      text: "That worked, thanks!",
      sender: "human",
      index: 2,
      created_at: "2025-06-01T10:25:00.000Z",
      updated_at: "2025-06-01T10:25:00.000Z",
    },
  ],
};

describe("parseClaudeAiSession", () => {
  it("extracts id, project, model, timestamps, duration, and message counts", () => {
    const s = parseClaudeAiSession(CONVERSATION);

    assert.equal(s.id, "abc-123-def");
    assert.equal(s.provider, "claude-ai");
    assert.equal(s.project, "debrief");
    assert.equal(s.model, "claude-sonnet-4-5-20250514");
    assert.equal(s.startTime, "2025-06-01T10:00:00.000Z");
    assert.equal(s.endTime, "2025-06-01T10:25:00.000Z");
    assert.equal(s.durationMin, 25);
    assert.equal(s.userMsgCount, 2);
    assert.equal(s.agentMsgCount, 1);
    assert.equal(s.eventCount, 3);
  });

  it("returns zero token counts (web conversations have no usage data)", () => {
    const s = parseClaudeAiSession(CONVERSATION);

    assert.equal(s.totalTokens, 0);
    assert.equal(s.inputTokens, 0);
    assert.equal(s.outputTokens, 0);
    assert.equal(s.reasoningTokens, 0);
    assert.equal(s.cachedTokens, 0);
  });

  it("returns empty tools map and no machine/cliVersion", () => {
    const s = parseClaudeAiSession(CONVERSATION);

    assert.deepEqual(s.tools, {});
    assert.equal(s.machine, null);
    assert.equal(s.cliVersion, null);
  });

  it("handles empty conversation gracefully", () => {
    const empty = { uuid: "empty-1", chat_messages: [] };
    const s = parseClaudeAiSession(empty);

    assert.equal(s.id, "empty-1");
    assert.equal(s.startTime, null);
    assert.equal(s.endTime, null);
    assert.equal(s.durationMin, 0);
    assert.equal(s.userMsgCount, 0);
    assert.equal(s.agentMsgCount, 0);
    assert.equal(s.eventCount, 0);
  });

  it("handles missing fields gracefully", () => {
    const minimal = {};
    const s = parseClaudeAiSession(minimal);

    assert.equal(s.id, "unknown");
    assert.equal(s.project, "");
    assert.equal(s.model, "");
    assert.equal(s.eventCount, 0);
  });
});

describe("condenseClaudeAi", () => {
  it("extracts turns, metadata, and duration", () => {
    const c = condenseClaudeAi(CONVERSATION);

    assert.equal(c.id, "abc-123-def");
    assert.equal(c.provider, "claude-ai");
    assert.equal(c.project, "debrief");
    assert.equal(c.model, "claude-sonnet-4-5-20250514");
    assert.equal(c.startTime, "2025-06-01T10:00:00.000Z");
    assert.equal(c.endTime, "2025-06-01T10:25:00.000Z");
    assert.equal(c.durationSec, 1500);
    assert.equal(c.userTurnCount, 2);
    assert.deepEqual(c.toolsUsed, {});
    assert.equal(c.turns.length, 3);
    assert.deepEqual(c.turns[0], { role: "user", text: "Why is my test flaky?" });
    assert.deepEqual(c.turns[1], {
      role: "assistant",
      text: "The test is flaky because it depends on timing. Here is a fix...",
    });
  });

  it("truncates turn text to 500 chars and limits to 20 turns", () => {
    const longText = "x".repeat(600);
    const manyMessages = Array.from({ length: 25 }, (_, i) => ({
      uuid: `msg-${i}`,
      text: i === 0 ? longText : `msg ${i}`,
      sender: i % 2 === 0 ? "human" : "assistant",
      index: i,
      created_at: "2025-06-01T10:00:00.000Z",
      updated_at: "2025-06-01T10:00:00.000Z",
    }));
    const conv = { uuid: "long-1", chat_messages: manyMessages };
    const c = condenseClaudeAi(conv);

    assert.equal(c.turns[0].text.length, 500);
    assert.equal(c.turns.length, 20);
  });

  it("handles empty conversation", () => {
    const c = condenseClaudeAi({ uuid: "empty-1", chat_messages: [] });

    assert.equal(c.id, "empty-1");
    assert.equal(c.startTime, null);
    assert.equal(c.endTime, null);
    assert.equal(c.durationSec, 0);
    assert.equal(c.userTurnCount, 0);
    assert.equal(c.turns.length, 0);
  });
});
