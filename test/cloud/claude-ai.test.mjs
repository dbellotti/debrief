import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../src/cloud/claude-ai.mjs";

const COOKIE = "sessionKey=sk-ant-sid01-test";
const ORG_ID = "org-123";

function mockFetch(handler) {
  return (url, opts) => handler(url, opts);
}

describe("createClient", () => {
  describe("fetchOrganizations", () => {
    it("returns parsed org list", async () => {
      const orgs = [{ uuid: "org-123", name: "My Org" }];
      const client = createClient(COOKIE, {
        fetch: mockFetch(() => ({
          ok: true,
          status: 200,
          json: async () => orgs,
        })),
      });

      const result = await client.fetchOrganizations();
      assert.deepEqual(result, orgs);
    });

    it("sends correct headers", async () => {
      let captured;
      const client = createClient(COOKIE, {
        fetch: mockFetch((url, opts) => {
          captured = { url, opts };
          return { ok: true, status: 200, json: async () => [] };
        }),
      });

      await client.fetchOrganizations();
      assert.equal(captured.url, "https://claude.ai/api/organizations");
      assert.ok(captured.opts.headers["Cookie"].includes(COOKIE));
      assert.ok(captured.opts.headers["User-Agent"]);
      assert.equal(captured.opts.headers["anthropic-client-platform"], "web_claude_ai");
    });
  });

  describe("listConversations", () => {
    it("returns conversation metadata array", async () => {
      const conversations = [
        { uuid: "conv-1", name: "Chat 1", updated_at: "2025-06-01T10:00:00Z" },
        { uuid: "conv-2", name: "Chat 2", updated_at: "2025-06-01T11:00:00Z" },
      ];
      const client = createClient(COOKIE, {
        fetch: mockFetch(() => ({
          ok: true,
          status: 200,
          json: async () => conversations,
        })),
      });

      const result = await client.listConversations(ORG_ID);
      assert.deepEqual(result, conversations);
    });

    it("hits the correct endpoint", async () => {
      let capturedUrl;
      const client = createClient(COOKIE, {
        fetch: mockFetch((url) => {
          capturedUrl = url;
          return { ok: true, status: 200, json: async () => [] };
        }),
      });

      await client.listConversations(ORG_ID);
      assert.equal(
        capturedUrl,
        "https://claude.ai/api/organizations/org-123/chat_conversations"
      );
    });
  });

  describe("getConversation", () => {
    it("returns full conversation data", async () => {
      const conversation = {
        uuid: "conv-1",
        name: "Chat 1",
        chat_messages: [{ uuid: "msg-1", text: "hi", sender: "human" }],
      };
      const client = createClient(COOKIE, {
        fetch: mockFetch(() => ({
          ok: true,
          status: 200,
          json: async () => conversation,
        })),
      });

      const result = await client.getConversation(ORG_ID, "conv-1");
      assert.deepEqual(result, conversation);
    });

    it("hits the correct endpoint", async () => {
      let capturedUrl;
      const client = createClient(COOKIE, {
        fetch: mockFetch((url) => {
          capturedUrl = url;
          return { ok: true, status: 200, json: async () => ({}) };
        }),
      });

      await client.getConversation(ORG_ID, "conv-1");
      assert.equal(
        capturedUrl,
        "https://claude.ai/api/organizations/org-123/chat_conversations/conv-1"
      );
    });
  });

  describe("error handling", () => {
    it("throws AuthError on 401", async () => {
      const client = createClient(COOKIE, {
        fetch: mockFetch(() => ({ ok: false, status: 401 })),
      });

      await assert.rejects(
        () => client.fetchOrganizations(),
        (err) => err.name === "AuthError" && err.status === 401
      );
    });

    it("throws AuthError on 403", async () => {
      const client = createClient(COOKIE, {
        fetch: mockFetch(() => ({ ok: false, status: 403 })),
      });

      await assert.rejects(
        () => client.listConversations(ORG_ID),
        (err) => err.name === "AuthError" && err.status === 403
      );
    });

    it("throws on other HTTP errors", async () => {
      const client = createClient(COOKIE, {
        fetch: mockFetch(() => ({ ok: false, status: 500 })),
      });

      await assert.rejects(
        () => client.getConversation(ORG_ID, "conv-1"),
        (err) => err.name !== "AuthError" && err.status === 500
      );
    });

    it("retries once on 429 then succeeds", async () => {
      let calls = 0;
      const client = createClient(COOKIE, {
        fetch: mockFetch(() => {
          calls++;
          if (calls === 1) return { ok: false, status: 429 };
          return { ok: true, status: 200, json: async () => [{ uuid: "conv-1" }] };
        }),
        retryDelay: 0,
      });

      const result = await client.listConversations(ORG_ID);
      assert.equal(calls, 2);
      assert.deepEqual(result, [{ uuid: "conv-1" }]);
    });

    it("throws after retry on second 429", async () => {
      const client = createClient(COOKIE, {
        fetch: mockFetch(() => ({ ok: false, status: 429 })),
        retryDelay: 0,
      });

      await assert.rejects(
        () => client.listConversations(ORG_ID),
        (err) => err.status === 429
      );
    });
  });
});
