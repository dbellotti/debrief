import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

export async function run(opts) {
  const dir = resolve(opts.dir || ".");

  await mkdir(join(dir, "machines"), { recursive: true });
  await mkdir(join(dir, "facets"), { recursive: true });

  const gitignore = join(dir, ".gitignore");
  if (!existsSync(gitignore)) {
    await writeFile(gitignore, "machines/\n", "utf-8");
  }

  console.log(`Archive initialized at ${dir}`);
  console.log("Next steps:");
  console.log("  debrief connect    # hook into Claude Code for automatic capture");
  console.log("  debrief collect    # sync existing sessions");
}
