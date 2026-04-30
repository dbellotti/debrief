import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse, condense } from "../../src/parsers/registry.mjs";

const CLAUDE_TUPLE = {
  provider: "claude",
  filepath: "/sessions/sess-1.jsonl",
  machine: "laptop",
  raw: [
    { sessionId: "sess-1", cwd: "/home/user/my-app", version: "1.0.0", type: "user", timestamp: "2025-06-01T10:00:00.000Z", message: { content: "hi" } },
    { type: "assistant", timestamp: "2025-06-01T10:01:00.000Z", message: { model: "claude-sonnet-4-5-20250514", usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: "text", text: "hello" }] } },
  ],
};

const CODEX_TUPLE = {
  provider: "codex",
  filepath: "/sessions/codex-1.jsonl",
  machine: "server",
  raw: [
    { type: "session_meta", timestamp: "2025-06-01T10:00:00.000Z", payload: { id: "codex-1", cwd: "/app" } },
    { type: "event_msg", timestamp: "2025-06-01T10:01:00.000Z", payload: { type: "user_message", message: "hello" } },
  ],
};

const CLAUDE_AI_TUPLE = {
  provider: "claude-ai",
  filepath: "/cloud/claude-ai/conv-1.json",
  machine: null,
  raw: {
    uuid: "ai-1",
    model: "claude-sonnet-4-5-20250514",
    project: { uuid: "p1", name: "test" },
    chat_messages: [
      { uuid: "m1", text: "hi", sender: "human", index: 0, created_at: "2025-06-01T10:00:00.000Z" },
    ],
  },
};

describe("registry parse", () => {
  it("dispatches claude-code tuples correctly", () => {
    const s = parse(CLAUDE_TUPLE);
    assert.equal(s.id, "sess-1");
    assert.equal(s.provider, "claude");
    assert.equal(s.machine, "laptop");
    assert.equal(s.project, "my-app");
  });

  it("dispatches codex tuples correctly", () => {
    const s = parse(CODEX_TUPLE);
    assert.equal(s.id, "codex-1");
    assert.equal(s.provider, "codex");
    assert.equal(s.machine, "server");
  });

  it("dispatches claude-ai tuples correctly", () => {
    const s = parse(CLAUDE_AI_TUPLE);
    assert.equal(s.id, "ai-1");
    assert.equal(s.provider, "claude-ai");
    assert.equal(s.machine, null);
  });

  it("throws for unknown provider", () => {
    assert.throws(() => parse({ provider: "unknown", raw: {} }), /unknown provider/i);
  });
});

describe("registry condense", () => {
  it("dispatches claude-code tuples correctly", () => {
    const s = condense(CLAUDE_TUPLE);
    assert.equal(s.id, "sess-1");
    assert.equal(s.provider, "claude");
    assert.equal(s.machine, "laptop");
  });

  it("dispatches codex tuples correctly", () => {
    const s = condense(CODEX_TUPLE);
    assert.equal(s.id, "codex-1");
    assert.equal(s.provider, "codex");
    assert.equal(s.machine, "server");
  });

  it("dispatches claude-ai tuples correctly", () => {
    const s = condense(CLAUDE_AI_TUPLE);
    assert.equal(s.id, "ai-1");
    assert.equal(s.provider, "claude-ai");
  });

  it("throws for unknown provider", () => {
    assert.throws(() => condense({ provider: "unknown", raw: {} }), /unknown provider/i);
  });
});
