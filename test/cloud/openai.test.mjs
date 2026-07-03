import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../src/cloud/openai.mjs";

const TOKEN = "eyJ-test-access-token";

function mockFetch(handler) {
  return (url, opts) => handler(url, opts);
}

describe("createClient (openai)", () => {
  describe("fetchMe", () => {
    it("returns parsed account info", async () => {
      const me = { id: "user-123", email: "me@example.com" };
      const client = createClient(TOKEN, {
        fetch: mockFetch(() => ({
          ok: true,
          status: 200,
          json: async () => me,
        })),
      });

      const result = await client.fetchMe();
      assert.deepEqual(result, me);
    });

    it("sends bearer authorization header", async () => {
      let captured;
      const client = createClient(TOKEN, {
        fetch: mockFetch((url, opts) => {
          captured = { url, opts };
          return { ok: true, status: 200, json: async () => ({}) };
        }),
      });

      await client.fetchMe();
      assert.equal(captured.url, "https://chatgpt.com/backend-api/me");
      assert.equal(captured.opts.headers["Authorization"], `Bearer ${TOKEN}`);
      assert.ok(captured.opts.headers["User-Agent"]);
    });
  });

  describe("listConversations", () => {
    it("returns items from a single page", async () => {
      const items = [
        { id: "conv-1", title: "Chat 1", update_time: "2025-06-01T10:00:00Z" },
        { id: "conv-2", title: "Chat 2", update_time: "2025-06-01T11:00:00Z" },
      ];
      const client = createClient(TOKEN, {
        fetch: mockFetch(() => ({
          ok: true,
          status: 200,
          json: async () => ({ items, total: 2, limit: 100, offset: 0 }),
        })),
      });

      const result = await client.listConversations();
      assert.deepEqual(result, items);
    });

    it("hits the correct endpoint", async () => {
      let capturedUrl;
      const client = createClient(TOKEN, {
        fetch: mockFetch((url) => {
          capturedUrl = url;
          return { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) };
        }),
      });

      await client.listConversations();
      assert.equal(
        capturedUrl,
        "https://chatgpt.com/backend-api/conversations?offset=0&limit=100&order=updated"
      );
    });

    it("paginates until all items are fetched", async () => {
      const allItems = Array.from({ length: 150 }, (_, i) => ({ id: `conv-${i}` }));
      const urls = [];
      const client = createClient(TOKEN, {
        fetch: mockFetch((url) => {
          urls.push(url);
          const offset = parseInt(new URL(url).searchParams.get("offset"));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              items: allItems.slice(offset, offset + 100),
              total: 150,
              limit: 100,
              offset,
            }),
          };
        }),
      });

      const result = await client.listConversations();
      assert.equal(result.length, 150);
      assert.equal(urls.length, 2);
      assert.ok(urls[1].includes("offset=100"));
    });
  });

  describe("getConversation", () => {
    it("returns full conversation data", async () => {
      const conversation = {
        conversation_id: "conv-1",
        title: "Chat 1",
        mapping: {},
      };
      const client = createClient(TOKEN, {
        fetch: mockFetch(() => ({
          ok: true,
          status: 200,
          json: async () => conversation,
        })),
      });

      const result = await client.getConversation("conv-1");
      assert.deepEqual(result, conversation);
    });

    it("hits the correct endpoint", async () => {
      let capturedUrl;
      const client = createClient(TOKEN, {
        fetch: mockFetch((url) => {
          capturedUrl = url;
          return { ok: true, status: 200, json: async () => ({}) };
        }),
      });

      await client.getConversation("conv-1");
      assert.equal(capturedUrl, "https://chatgpt.com/backend-api/conversation/conv-1");
    });
  });

  describe("error handling", () => {
    it("throws AuthError on 401", async () => {
      const client = createClient(TOKEN, {
        fetch: mockFetch(() => ({ ok: false, status: 401 })),
      });

      await assert.rejects(
        () => client.fetchMe(),
        (err) => err.name === "AuthError" && err.status === 401
      );
    });

    it("throws AuthError on 403", async () => {
      const client = createClient(TOKEN, {
        fetch: mockFetch(() => ({ ok: false, status: 403 })),
      });

      await assert.rejects(
        () => client.listConversations(),
        (err) => err.name === "AuthError" && err.status === 403
      );
    });

    it("throws on other HTTP errors", async () => {
      const client = createClient(TOKEN, {
        fetch: mockFetch(() => ({ ok: false, status: 500 })),
      });

      await assert.rejects(
        () => client.getConversation("conv-1"),
        (err) => err.name !== "AuthError" && err.status === 500
      );
    });

    it("retries once on 429 then succeeds", async () => {
      let calls = 0;
      const client = createClient(TOKEN, {
        fetch: mockFetch(() => {
          calls++;
          if (calls === 1) return { ok: false, status: 429 };
          return { ok: true, status: 200, json: async () => ({ items: [{ id: "conv-1" }], total: 1 }) };
        }),
        retryDelay: 0,
      });

      const result = await client.listConversations();
      assert.equal(calls, 2);
      assert.deepEqual(result, [{ id: "conv-1" }]);
    });

    it("throws after retry on second 429", async () => {
      const client = createClient(TOKEN, {
        fetch: mockFetch(() => ({ ok: false, status: 429 })),
        retryDelay: 0,
      });

      await assert.rejects(
        () => client.listConversations(),
        (err) => err.status === 429
      );
    });
  });
});
