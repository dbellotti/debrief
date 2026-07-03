import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseOpenAiSession, condenseOpenAi } from "../../src/parsers/openai.mjs";

// Realistic fixture matching the chatgpt.com GET conversation response shape
const CONVERSATION = {
  conversation_id: "abc-123-def",
  title: "Debug flaky test",
  create_time: 1748772000,
  update_time: 1748773500,
  default_model_slug: "gpt-4o",
  current_node: "node-3",
  mapping: {
    "node-root": {
      id: "node-root",
      message: null,
      parent: null,
      children: ["node-sys"],
    },
    "node-sys": {
      id: "node-sys",
      message: {
        id: "msg-sys",
        author: { role: "system" },
        create_time: null,
        content: { content_type: "text", parts: [""] },
        metadata: { is_visually_hidden_from_conversation: true },
      },
      parent: "node-root",
      children: ["node-1"],
    },
    "node-1": {
      id: "node-1",
      message: {
        id: "msg-1",
        author: { role: "user" },
        create_time: 1748772000,
        content: { content_type: "text", parts: ["Why is my test flaky?"] },
        metadata: {},
      },
      parent: "node-sys",
      children: ["node-2"],
    },
    "node-2": {
      id: "node-2",
      message: {
        id: "msg-2",
        author: { role: "assistant" },
        create_time: 1748772060,
        content: { content_type: "text", parts: ["The test is flaky because it depends on timing. Here is a fix..."] },
        metadata: { model_slug: "gpt-4o" },
        recipient: "all",
      },
      parent: "node-1",
      children: ["node-3"],
    },
    "node-3": {
      id: "node-3",
      message: {
        id: "msg-3",
        author: { role: "user" },
        create_time: 1748773500,
        content: { content_type: "text", parts: ["That worked, thanks!"] },
        metadata: {},
      },
      parent: "node-2",
      children: [],
    },
  },
};

describe("parseOpenAiSession", () => {
  it("extracts id, model, timestamps, duration, and message counts", () => {
    const s = parseOpenAiSession(CONVERSATION);

    assert.equal(s.id, "abc-123-def");
    assert.equal(s.provider, "openai");
    assert.equal(s.model, "gpt-4o");
    assert.equal(s.startTime, new Date(1748772000 * 1000).toISOString());
    assert.equal(s.endTime, new Date(1748773500 * 1000).toISOString());
    assert.equal(s.durationMin, 25);
    assert.equal(s.userMsgCount, 2);
    assert.equal(s.agentMsgCount, 1);
    assert.equal(s.eventCount, 3);
  });

  it("skips hidden system messages", () => {
    const s = parseOpenAiSession(CONVERSATION);
    assert.equal(s.eventCount, 3);
  });

  it("skips tool-directed assistant messages", () => {
    const conv = JSON.parse(JSON.stringify(CONVERSATION));
    conv.mapping["node-2"].message.recipient = "python";
    const s = parseOpenAiSession(conv);

    assert.equal(s.agentMsgCount, 0);
    assert.equal(s.eventCount, 2);
  });

  it("falls back to assistant model_slug when default_model_slug is missing", () => {
    const conv = JSON.parse(JSON.stringify(CONVERSATION));
    delete conv.default_model_slug;
    conv.mapping["node-2"].message.metadata.model_slug = "gpt-4-turbo";
    const s = parseOpenAiSession(conv);

    assert.equal(s.model, "gpt-4-turbo");
  });

  it("orders by create_time when current_node is missing", () => {
    const conv = JSON.parse(JSON.stringify(CONVERSATION));
    delete conv.current_node;
    const s = parseOpenAiSession(conv);

    assert.equal(s.eventCount, 3);
    assert.equal(s.startTime, new Date(1748772000 * 1000).toISOString());
  });

  it("returns zero token counts (web conversations have no usage data)", () => {
    const s = parseOpenAiSession(CONVERSATION);

    assert.equal(s.totalTokens, 0);
    assert.equal(s.inputTokens, 0);
    assert.equal(s.outputTokens, 0);
    assert.equal(s.reasoningTokens, 0);
    assert.equal(s.cachedTokens, 0);
  });

  it("returns empty tools map and no machine/cliVersion/project", () => {
    const s = parseOpenAiSession(CONVERSATION);

    assert.deepEqual(s.tools, {});
    assert.equal(s.machine, null);
    assert.equal(s.cliVersion, null);
    assert.equal(s.project, "");
  });

  it("handles empty conversation gracefully", () => {
    const empty = { conversation_id: "empty-1", mapping: {} };
    const s = parseOpenAiSession(empty);

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
    const s = parseOpenAiSession(minimal);

    assert.equal(s.id, "unknown");
    assert.equal(s.model, "");
    assert.equal(s.eventCount, 0);
  });
});

describe("condenseOpenAi", () => {
  it("extracts turns, metadata, and duration", () => {
    const c = condenseOpenAi(CONVERSATION);

    assert.equal(c.id, "abc-123-def");
    assert.equal(c.provider, "openai");
    assert.equal(c.model, "gpt-4o");
    assert.equal(c.startTime, new Date(1748772000 * 1000).toISOString());
    assert.equal(c.endTime, new Date(1748773500 * 1000).toISOString());
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

  it("joins string parts and ignores non-string parts", () => {
    const conv = JSON.parse(JSON.stringify(CONVERSATION));
    conv.mapping["node-1"].message.content = {
      content_type: "multimodal_text",
      parts: ["Look at ", { content_type: "image_asset_pointer" }, "this image"],
    };
    const c = condenseOpenAi(conv);

    assert.equal(c.turns[0].text, "Look at this image");
  });

  it("truncates turn text to 500 chars and limits to 20 turns", () => {
    const longText = "x".repeat(600);
    const mapping = { "node-root": { id: "node-root", message: null, parent: null, children: ["node-0"] } };
    for (let i = 0; i < 25; i++) {
      mapping[`node-${i}`] = {
        id: `node-${i}`,
        message: {
          id: `msg-${i}`,
          author: { role: i % 2 === 0 ? "user" : "assistant" },
          create_time: 1748772000 + i,
          content: { content_type: "text", parts: [i === 0 ? longText : `msg ${i}`] },
          metadata: {},
        },
        parent: i === 0 ? "node-root" : `node-${i - 1}`,
        children: i === 24 ? [] : [`node-${i + 1}`],
      };
    }
    const conv = { conversation_id: "long-1", current_node: "node-24", mapping };
    const c = condenseOpenAi(conv);

    assert.equal(c.turns[0].text.length, 500);
    assert.equal(c.turns.length, 20);
  });

  it("handles empty conversation", () => {
    const c = condenseOpenAi({ conversation_id: "empty-1", mapping: {} });

    assert.equal(c.id, "empty-1");
    assert.equal(c.startTime, null);
    assert.equal(c.endTime, null);
    assert.equal(c.durationSec, 0);
    assert.equal(c.userTurnCount, 0);
    assert.equal(c.turns.length, 0);
  });
});
