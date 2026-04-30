import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCodexSession, condenseCodex } from "../../src/parsers/codex.mjs";

// Realistic JSONL lines matching codex session format
const LINES = [
  {
    type: "session_meta",
    timestamp: "2025-06-01T10:00:00.000Z",
    payload: {
      id: "codex-sess-001",
      cwd: "/home/user/projects/my-api",
      cli_version: "0.5.1",
    },
  },
  {
    type: "turn_context",
    timestamp: "2025-06-01T10:00:01.000Z",
    payload: { model: "o4-mini" },
  },
  {
    type: "event_msg",
    timestamp: "2025-06-01T10:00:02.000Z",
    payload: { type: "user_message", message: "Add a health check endpoint" },
  },
  {
    type: "response_item",
    timestamp: "2025-06-01T10:01:00.000Z",
    payload: { type: "function_call", name: "shell" },
  },
  {
    type: "response_item",
    timestamp: "2025-06-01T10:01:30.000Z",
    payload: { type: "function_call", name: "shell" },
  },
  {
    type: "response_item",
    timestamp: "2025-06-01T10:02:00.000Z",
    payload: { type: "function_call", name: "apply_patch" },
  },
  {
    type: "event_msg",
    timestamp: "2025-06-01T10:03:00.000Z",
    payload: { type: "agent_message", message: "Done! Added GET /health." },
  },
  {
    type: "event_msg",
    timestamp: "2025-06-01T10:05:00.000Z",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          total_tokens: 5000,
          input_tokens: 3000,
          output_tokens: 1500,
          reasoning_output_tokens: 400,
          cached_input_tokens: 100,
        },
      },
    },
  },
];

describe("parseCodexSession", () => {
  it("extracts id, machine, project, model, version, timestamps, duration, tokens, tools, and message counts", () => {
    const s = parseCodexSession(LINES, "server");

    assert.equal(s.id, "codex-sess-001");
    assert.equal(s.machine, "server");
    assert.equal(s.provider, "codex");
    assert.equal(s.project, "my-api");
    assert.equal(s.model, "o4-mini");
    assert.equal(s.cliVersion, "0.5.1");
    assert.equal(s.startTime, "2025-06-01T10:00:00.000Z");
    assert.equal(s.endTime, "2025-06-01T10:05:00.000Z");
    assert.equal(s.durationMin, 5);
    assert.equal(s.totalTokens, 5000);
    assert.equal(s.inputTokens, 3000);
    assert.equal(s.outputTokens, 1500);
    assert.equal(s.reasoningTokens, 400);
    assert.equal(s.cachedTokens, 100);
    assert.deepEqual(s.tools, { shell: 2, apply_patch: 1 });
    assert.equal(s.userMsgCount, 1);
    assert.equal(s.agentMsgCount, 1);
    assert.equal(s.eventCount, 8);
  });

  it("handles empty lines array", () => {
    const s = parseCodexSession([], "host");

    assert.equal(s.id, "unknown");
    assert.equal(s.project, "");
    assert.equal(s.cliVersion, "");
    assert.equal(s.startTime, null);
    assert.equal(s.endTime, null);
    assert.equal(s.durationMin, 0);
    assert.equal(s.totalTokens, 0);
    assert.equal(s.userMsgCount, 0);
    assert.equal(s.agentMsgCount, 0);
  });

  it("handles lines with missing payload fields", () => {
    const sparse = [
      { type: "session_meta" },
      { type: "turn_context" },
    ];
    const s = parseCodexSession(sparse, "host");

    assert.equal(s.id, "unknown");
    assert.equal(s.model, "");
    assert.equal(s.totalTokens, 0);
    assert.deepEqual(s.tools, {});
  });
});

describe("condenseCodex", () => {
  it("extracts turns, metadata, duration, and tools", () => {
    const c = condenseCodex(LINES, "/sessions/codex-sess-001.jsonl");

    assert.equal(c.id, "codex-sess-001");
    assert.equal(c.provider, "codex");
    assert.equal(c.project, "my-api");
    assert.equal(c.model, "o4-mini");
    assert.equal(c.startTime, "2025-06-01T10:00:00.000Z");
    assert.equal(c.endTime, "2025-06-01T10:05:00.000Z");
    assert.equal(c.durationSec, 300);
    assert.equal(c.userTurnCount, 1);
    assert.deepEqual(c.toolsUsed, { shell: 2, apply_patch: 1 });
    assert.equal(c.turns.length, 2);
    assert.deepEqual(c.turns[0], { role: "user", text: "Add a health check endpoint" });
    assert.deepEqual(c.turns[1], { role: "assistant", text: "Done! Added GET /health." });
  });

  it("truncates turn text to 500 chars and limits to 20 turns", () => {
    const longMsg = "y".repeat(600);
    const manyLines = [
      { type: "session_meta", timestamp: "2025-06-01T10:00:00.000Z", payload: { id: "long" } },
      ...Array.from({ length: 25 }, (_, i) => ({
        type: "event_msg",
        timestamp: `2025-06-01T10:${String(i).padStart(2, "0")}:00.000Z`,
        payload: {
          type: i % 2 === 0 ? "user_message" : "agent_message",
          message: i === 0 ? longMsg : `msg ${i}`,
        },
      })),
    ];
    const c = condenseCodex(manyLines, "/sessions/long.jsonl");

    assert.equal(c.turns[0].text.length, 500);
    assert.equal(c.turns.length, 20);
  });

  it("handles empty lines array", () => {
    const c = condenseCodex([], "/sessions/empty.jsonl");

    assert.equal(c.id, "empty");
    assert.equal(c.startTime, null);
    assert.equal(c.endTime, null);
    assert.equal(c.durationSec, 0);
    assert.equal(c.userTurnCount, 0);
    assert.equal(c.turns.length, 0);
  });
});
