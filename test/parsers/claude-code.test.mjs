import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeSession, condenseClaude } from "../../src/parsers/claude-code.mjs";

// Realistic JSONL lines matching claude-code session format
const LINES = [
  {
    sessionId: "sess-abc-123",
    uuid: "uuid-1",
    cwd: "/home/user/projects/my-app",
    version: "1.0.42",
    type: "user",
    timestamp: "2025-06-01T10:00:00.000Z",
    message: { content: "Fix the login bug" },
  },
  {
    type: "assistant",
    timestamp: "2025-06-01T10:01:00.000Z",
    message: {
      model: "claude-sonnet-4-5-20250514",
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 100,
      },
      content: [
        { type: "text", text: "I'll fix that for you." },
        { type: "tool_use", name: "Edit" },
        { type: "tool_use", name: "Edit" },
        { type: "tool_use", name: "Bash" },
      ],
    },
  },
  {
    type: "user",
    timestamp: "2025-06-01T10:05:00.000Z",
    message: { content: "Thanks, that worked!" },
  },
  {
    type: "assistant",
    timestamp: "2025-06-01T10:06:00.000Z",
    message: {
      model: "claude-sonnet-4-5-20250514",
      usage: {
        input_tokens: 800,
        output_tokens: 300,
        cache_read_input_tokens: 150,
        cache_creation_input_tokens: 50,
      },
      content: [{ type: "text", text: "Glad it works!" }],
    },
  },
];

describe("parseClaudeSession", () => {
  it("extracts id, machine, project, model, version, timestamps, duration, tokens, tools, and message counts", () => {
    const s = parseClaudeSession(LINES, "workstation");

    assert.equal(s.id, "sess-abc-123");
    assert.equal(s.machine, "workstation");
    assert.equal(s.provider, "claude");
    assert.equal(s.project, "my-app");
    assert.equal(s.model, "claude-sonnet-4-5-20250514");
    assert.equal(s.cliVersion, "1.0.42");
    assert.equal(s.startTime, "2025-06-01T10:00:00.000Z");
    assert.equal(s.endTime, "2025-06-01T10:06:00.000Z");
    assert.equal(s.durationMin, 6);
    assert.equal(s.inputTokens, 1800);
    assert.equal(s.outputTokens, 800);
    assert.equal(s.cachedTokens, 500);
    assert.equal(s.totalTokens, 1800 + 800 + 350 + 150);
    assert.equal(s.reasoningTokens, 0);
    assert.deepEqual(s.tools, { Edit: 2, Bash: 1 });
    assert.equal(s.userMsgCount, 2);
    assert.equal(s.agentMsgCount, 2);
    assert.equal(s.eventCount, 4);
  });

  it("handles empty lines array", () => {
    const s = parseClaudeSession([], "host");

    assert.equal(s.id, "unknown");
    assert.equal(s.project, "");
    assert.equal(s.cliVersion, "");
    assert.equal(s.startTime, null);
    assert.equal(s.endTime, null);
    assert.equal(s.durationMin, 0);
    assert.equal(s.totalTokens, 0);
    assert.equal(s.userMsgCount, 0);
    assert.equal(s.agentMsgCount, 0);
    assert.equal(s.eventCount, 0);
  });

  it("handles lines with missing fields gracefully", () => {
    const sparse = [{ type: "user" }, { type: "assistant" }];
    const s = parseClaudeSession(sparse, "host");

    assert.equal(s.id, "unknown");
    assert.equal(s.model, "");
    assert.equal(s.totalTokens, 0);
    assert.deepEqual(s.tools, {});
    // isMeta is undefined/falsy, so both count
    assert.equal(s.userMsgCount, 1);
    assert.equal(s.agentMsgCount, 1);
  });

  it("skips meta user messages in count", () => {
    const lines = [
      { type: "user", isMeta: true, timestamp: "2025-06-01T10:00:00.000Z" },
      { type: "user", timestamp: "2025-06-01T10:01:00.000Z", message: { content: "hello" } },
    ];
    const s = parseClaudeSession(lines, "host");

    assert.equal(s.userMsgCount, 1);
  });
});

describe("condenseClaude", () => {
  it("extracts turns, metadata, duration, and tools", () => {
    const c = condenseClaude(LINES, "/sessions/sess-abc-123.jsonl");

    assert.equal(c.id, "sess-abc-123");
    assert.equal(c.provider, "claude");
    assert.equal(c.project, "my-app");
    assert.equal(c.model, "claude-sonnet-4-5-20250514");
    assert.equal(c.startTime, "2025-06-01T10:00:00.000Z");
    assert.equal(c.endTime, "2025-06-01T10:06:00.000Z");
    assert.equal(c.durationSec, 360);
    assert.equal(c.userTurnCount, 2);
    assert.deepEqual(c.toolsUsed, { Edit: 2, Bash: 1 });
    assert.equal(c.turns.length, 4); // 2 user + 2 assistant text blocks
    assert.deepEqual(c.turns[0], { role: "user", text: "Fix the login bug" });
    assert.deepEqual(c.turns[1], { role: "assistant", text: "I'll fix that for you." });
  });

  it("truncates turn text to 500 chars and limits to 20 turns", () => {
    const longText = "x".repeat(600);
    const manyLines = Array.from({ length: 25 }, (_, i) => ({
      type: i % 2 === 0 ? "user" : "assistant",
      timestamp: `2025-06-01T10:${String(i).padStart(2, "0")}:00.000Z`,
      message: {
        content: i % 2 === 0
          ? (i === 0 ? longText : `msg ${i}`)
          : [{ type: "text", text: `reply ${i}` }],
      },
    }));
    const c = condenseClaude(manyLines, "/sessions/long.jsonl");

    assert.equal(c.turns[0].text.length, 500);
    assert.equal(c.turns.length, 20);
  });

  it("skips command-prefixed and meta user messages", () => {
    const lines = [
      { type: "user", isMeta: true, timestamp: "2025-06-01T10:00:00.000Z", message: { content: "meta stuff" } },
      { type: "user", timestamp: "2025-06-01T10:01:00.000Z", message: { content: "<command-foo>bar</command-foo>" } },
      { type: "user", timestamp: "2025-06-01T10:02:00.000Z", message: { content: "real message" } },
    ];
    const c = condenseClaude(lines, "/sessions/test.jsonl");

    assert.equal(c.turns.length, 1);
    assert.equal(c.turns[0].text, "real message");
  });

  it("handles empty lines array", () => {
    const c = condenseClaude([], "/sessions/empty.jsonl");

    assert.equal(c.id, "empty");
    assert.equal(c.startTime, null);
    assert.equal(c.endTime, null);
    assert.equal(c.durationSec, 0);
    assert.equal(c.userTurnCount, 0);
    assert.equal(c.turns.length, 0);
  });
});
