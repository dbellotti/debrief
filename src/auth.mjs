import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { createClient } from "./cloud/claude-ai.mjs";
import { createClient as createOpenAiClient } from "./cloud/openai.mjs";

export const AUTH_PATH = join(
  process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
  "debrief",
  "auth.json"
);

export async function loadAuth() {
  if (!existsSync(AUTH_PATH)) return null;
  try {
    return JSON.parse(await readFile(AUTH_PATH, "utf-8"));
  } catch {
    return null;
  }
}

async function saveAuth(fields) {
  const existing = (await loadAuth()) || {};
  await mkdir(dirname(AUTH_PATH), { recursive: true });
  await writeFile(AUTH_PATH, JSON.stringify({ ...existing, ...fields }, null, 2) + "\n", "utf-8");
}

export async function run(flags = {}) {
  const provider = flags._?.[0] || "claude-ai";
  if (provider === "claude-ai") {
    await authClaudeAi();
  } else if (provider === "openai") {
    await authOpenAi();
  } else {
    console.error(`Unknown provider: ${provider} (expected "claude-ai" or "openai")`);
    process.exit(1);
  }
}

async function authClaudeAi() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let cookie = (await rl.question("Paste your claude.ai sessionKey cookie: ")).trim();
    if (!cookie) {
      console.error("No cookie provided.");
      process.exit(1);
    }
    // Accept raw value or full cookie string
    if (!cookie.startsWith("sessionKey=")) {
      cookie = `sessionKey=${cookie}`;
    }

    console.log("Validating...");
    const client = createClient(cookie);
    let orgs;
    try {
      orgs = await client.fetchOrganizations();
    } catch (e) {
      if (e.name === "AuthError") {
        console.error("Authentication failed. Check your cookie and try again.");
      } else {
        console.error(`Failed to reach claude.ai: ${e.message}`);
      }
      process.exit(1);
    }

    if (!orgs.length) {
      console.error("No organizations found for this account.");
      process.exit(1);
    }

    // Pick the org that has chat capability (not just API)
    const chatOrg = orgs.find(o =>
      Array.isArray(o.capabilities) && o.capabilities.includes("chat")
    ) || orgs[0];
    const orgId = chatOrg.uuid;
    const orgName = chatOrg.name || orgId;

    await saveAuth({ cookie, orgId });

    console.log(`Authenticated as "${orgName}" (${orgId}).`);
    console.log(`Cookie saved to ${AUTH_PATH}`);
  } finally {
    rl.close();
  }
}

async function authOpenAi() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let accessToken = (await rl.question("Paste your chatgpt.com access token (from https://chatgpt.com/api/auth/session): ")).trim();
    if (!accessToken) {
      console.error("No access token provided.");
      process.exit(1);
    }
    // Accept raw value or full Authorization header
    if (accessToken.startsWith("Bearer ")) {
      accessToken = accessToken.slice("Bearer ".length).trim();
    }

    console.log("Validating...");
    const client = createOpenAiClient(accessToken);
    let me;
    try {
      me = await client.fetchMe();
    } catch (e) {
      if (e.name === "AuthError") {
        console.error("Authentication failed. Check your access token and try again.");
      } else {
        console.error(`Failed to reach chatgpt.com: ${e.message}`);
      }
      process.exit(1);
    }

    await saveAuth({ openai: { accessToken } });

    console.log(`Authenticated as "${me.email || me.name || me.id}".`);
    console.log(`Token saved to ${AUTH_PATH}`);
  } finally {
    rl.close();
  }
}
