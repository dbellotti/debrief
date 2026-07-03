const BASE = "https://chatgpt.com";

const DEFAULT_RETRY_DELAY = 5000;
const PAGE_SIZE = 100;

export function createClient(accessToken, { fetch: fetchFn = globalThis.fetch, retryDelay = DEFAULT_RETRY_DELAY } = {}) {
  function headers() {
    return {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
      "Origin": "https://chatgpt.com",
      "Referer": "https://chatgpt.com/",
      "Authorization": `Bearer ${accessToken}`,
    };
  }

  async function request(path, retried = false) {
    const url = `${BASE}${path}`;
    const res = await fetchFn(url, { headers: headers() });

    if (res.status === 429 && !retried) {
      await new Promise(r => setTimeout(r, retryDelay));
      return request(path, true);
    }

    if (!res.ok) {
      const err = new Error(`chatgpt.com API error: ${res.status}`);
      err.status = res.status;
      if (res.status === 401 || res.status === 403) {
        err.name = "AuthError";
      }
      throw err;
    }

    return res.json();
  }

  return {
    async fetchMe() {
      return request("/backend-api/me");
    },

    async listConversations() {
      const items = [];
      let offset = 0;
      while (true) {
        const page = await request(`/backend-api/conversations?offset=${offset}&limit=${PAGE_SIZE}&order=updated`);
        const pageItems = page.items || [];
        items.push(...pageItems);
        offset += pageItems.length;
        if (pageItems.length < PAGE_SIZE || offset >= (page.total ?? 0)) break;
      }
      return items;
    },

    async getConversation(conversationId) {
      return request(`/backend-api/conversation/${conversationId}`);
    },
  };
}
