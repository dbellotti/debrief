import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { createClient } from "./cloud/claude-ai.mjs";

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

export async function run() {
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

    await mkdir(dirname(AUTH_PATH), { recursive: true });
    await writeFile(AUTH_PATH, JSON.stringify({ cookie, orgId }, null, 2) + "\n", "utf-8");

    console.log(`Authenticated as "${orgName}" (${orgId}).`);
    console.log(`Cookie saved to ${AUTH_PATH}`);
  } finally {
    rl.close();
  }
}
