import { randomUUID } from "node:crypto";

const BASE = "https://claude.ai";

const DEFAULT_RETRY_DELAY = 5000;

export function createClient(cookie, { fetch: fetchFn = globalThis.fetch, retryDelay = DEFAULT_RETRY_DELAY } = {}) {
  const deviceId = randomUUID();
  const activitySessionId = randomUUID();

  function headers(orgId) {
    const h = {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
      "Origin": "https://claude.ai",
      "Referer": "https://claude.ai/new",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Connection": "keep-alive",
      "anthropic-client-platform": "web_claude_ai",
      "anthropic-client-version": "1.0.0",
      "anthropic-device-id": deviceId,
      "x-activity-session-id": activitySessionId,
      "Cookie": cookie + `; anthropic-device-id=${deviceId}; activitySessionId=${activitySessionId}`,
    };
    if (orgId) {
      h.Cookie += `; lastActiveOrg=${orgId}`;
    }
    return h;
  }

  async function request(path, orgId, retried = false) {
    const url = `${BASE}${path}`;
    const res = await fetchFn(url, { headers: headers(orgId) });

    if (res.status === 429 && !retried) {
      await new Promise(r => setTimeout(r, retryDelay));
      return request(path, orgId, true);
    }

    if (!res.ok) {
      const err = new Error(`claude.ai API error: ${res.status}`);
      err.status = res.status;
      if (res.status === 401 || res.status === 403) {
        err.name = "AuthError";
      }
      throw err;
    }

    return res.json();
  }

  return {
    async fetchOrganizations() {
      return request("/api/organizations", null);
    },

    async listConversations(orgId) {
      return request(`/api/organizations/${orgId}/chat_conversations`, orgId);
    },

    async getConversation(orgId, conversationId) {
      return request(`/api/organizations/${orgId}/chat_conversations/${conversationId}`, orgId);
    },
  };
}
