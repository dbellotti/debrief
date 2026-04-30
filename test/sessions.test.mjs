import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSessionFiles } from "../src/sessions.mjs";

let tmpDir;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "debrief-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// Helper to write a JSONL file from an array of objects
async function writeJsonl(filepath, lines) {
  await mkdir(join(filepath, ".."), { recursive: true });
  await writeFile(filepath, lines.map(l => JSON.stringify(l)).join("\n"), "utf-8");
}

// Helper to write a JSON file
async function writeJson(filepath, obj) {
  await mkdir(join(filepath, ".."), { recursive: true });
  await writeFile(filepath, JSON.stringify(obj), "utf-8");
}

const CODEX_LINES = [
  { type: "session_meta", timestamp: "2025-06-01T10:00:00.000Z", payload: { id: "codex-1", cwd: "/app" } },
  { type: "event_msg", timestamp: "2025-06-01T10:01:00.000Z", payload: { type: "user_message", message: "hello" } },
];

const CLAUDE_LINES = [
  { sessionId: "claude-1", cwd: "/app", type: "user", timestamp: "2025-06-01T10:00:00.000Z", message: { content: "hi" } },
  { type: "assistant", timestamp: "2025-06-01T10:01:00.000Z", message: { content: [{ type: "text", text: "hey" }] } },
];

const CLAUDE_AI_CONV = {
  uuid: "ai-1",
  name: "Test conv",
  chat_messages: [{ uuid: "m1", text: "hi", sender: "human", index: 0 }],
};

describe("loadSessionFiles", () => {
  it("discovers codex sessions and returns correct tuple shape", async () => {
    const codexDir = join(tmpDir, "machines", "laptop", "codex", "sessions");
    await writeJsonl(join(codexDir, "sess1.jsonl"), CODEX_LINES);

    const results = await loadSessionFiles(tmpDir);

    assert.equal(results.length, 1);
    const r = results[0];
    assert.equal(r.provider, "codex");
    assert.equal(r.machine, "laptop");
    assert.ok(r.filepath.endsWith("sess1.jsonl"));
    assert.ok(Array.isArray(r.raw));
    assert.equal(r.raw.length, 2);
    assert.equal(r.raw[0].type, "session_meta");
  });

  it("discovers claude-code sessions under machines/<host>/claude/projects/", async () => {
    const claudeDir = join(tmpDir, "machines", "desktop", "claude", "projects", "my-app");
    await writeJsonl(join(claudeDir, "sess1.jsonl"), CLAUDE_LINES);

    const results = await loadSessionFiles(tmpDir);

    assert.equal(results.length, 1);
    assert.equal(results[0].provider, "claude");
    assert.equal(results[0].machine, "desktop");
    assert.equal(results[0].raw[0].sessionId, "claude-1");
  });

  it("discovers claude-ai conversations under cloud/claude-ai/", async () => {
    const cloudDir = join(tmpDir, "cloud", "claude-ai");
    await writeJson(join(cloudDir, "conv1.json"), CLAUDE_AI_CONV);

    const results = await loadSessionFiles(tmpDir);

    assert.equal(results.length, 1);
    assert.equal(results[0].provider, "claude-ai");
    assert.equal(results[0].machine, null);
    assert.equal(results[0].raw.uuid, "ai-1");
  });

  it("skips files in subagents directories", async () => {
    const projectDir = join(tmpDir, "machines", "host", "claude", "projects", "app");
    await writeJsonl(join(projectDir, "main.jsonl"), CLAUDE_LINES);
    await writeJsonl(join(projectDir, "subagents", "child.jsonl"), CLAUDE_LINES);

    const results = await loadSessionFiles(tmpDir);

    assert.equal(results.length, 1);
    assert.ok(results[0].filepath.endsWith("main.jsonl"));
  });

  it("applies provider filter", async () => {
    const codexDir = join(tmpDir, "machines", "host", "codex", "sessions");
    await writeJsonl(join(codexDir, "s1.jsonl"), CODEX_LINES);
    const claudeDir = join(tmpDir, "machines", "host", "claude", "projects", "app");
    await writeJsonl(join(claudeDir, "s2.jsonl"), CLAUDE_LINES);

    const results = await loadSessionFiles(tmpDir, { providers: new Set(["codex"]) });

    assert.equal(results.length, 1);
    assert.equal(results[0].provider, "codex");
  });

  it("applies machine filter", async () => {
    const dir1 = join(tmpDir, "machines", "laptop", "codex", "sessions");
    await writeJsonl(join(dir1, "s1.jsonl"), CODEX_LINES);
    const dir2 = join(tmpDir, "machines", "server", "codex", "sessions");
    await writeJsonl(join(dir2, "s2.jsonl"), CODEX_LINES);

    const results = await loadSessionFiles(tmpDir, { machine: "laptop" });

    assert.equal(results.length, 1);
    assert.equal(results[0].machine, "laptop");
  });

  it("handles missing directories gracefully", async () => {
    const results = await loadSessionFiles(tmpDir);

    assert.deepEqual(results, []);
  });

  it("discovers sessions across all providers in one archive", async () => {
    await writeJsonl(join(tmpDir, "machines", "host", "codex", "sessions", "s1.jsonl"), CODEX_LINES);
    await writeJsonl(join(tmpDir, "machines", "host", "claude", "projects", "app", "s2.jsonl"), CLAUDE_LINES);
    await writeJson(join(tmpDir, "cloud", "claude-ai", "c1.json"), CLAUDE_AI_CONV);

    const results = await loadSessionFiles(tmpDir);

    const providers = results.map(r => r.provider).sort();
    assert.deepEqual(providers, ["claude", "claude-ai", "codex"]);
  });
});
