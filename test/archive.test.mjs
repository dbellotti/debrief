import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withArchive } from "../src/archive.mjs";

let tmpDir;
let origXdg;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "debrief-archive-test-"));
  // Isolate from real config so getArchiveType returns "local"
  origXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(tmpDir, "xdg");
});

afterEach(async () => {
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = origXdg;
  await rm(tmpDir, { recursive: true, force: true });
});

describe("withArchive", () => {
  it("calls callback with localPath and archiveType for local archives", async () => {
    let received;
    await withArchive(tmpDir, ["machines"], (ctx) => {
      received = ctx;
    });

    assert.equal(received.localPath, tmpDir);
    assert.equal(received.archiveType, "local");
    assert.equal(typeof received.syncBack, "function");
    assert.equal(typeof received.commitAndPush, "function");
  });

  it("returns the callback's return value", async () => {
    const result = await withArchive(tmpDir, [], () => 42);
    assert.equal(result, 42);
  });

  it("returns async callback's resolved value", async () => {
    const result = await withArchive(tmpDir, [], async () => "hello");
    assert.equal(result, "hello");
  });

  it("propagates callback errors after cleanup", async () => {
    await assert.rejects(
      () => withArchive(tmpDir, [], () => { throw new Error("boom"); }),
      { message: "boom" },
    );
  });

  it("commitAndPush is a no-op for local archives", async () => {
    let result;
    await withArchive(tmpDir, [], async (ctx) => {
      result = await ctx.commitAndPush("test message");
    });

    assert.equal(result, false);
  });
});
