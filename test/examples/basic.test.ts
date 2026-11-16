import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");
const examplesDir = join(repoRoot, "examples", "basic");
const scripts = readdirSync(examplesDir)
  .filter((file) => file.endsWith(".ts") && file !== "mock-provider.ts")
  .sort();

describe("examples/basic scripts run", () => {
  test("discovers example scripts", () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  for (const script of scripts) {
    test(script, () => {
      const result = spawnSync(process.execPath, [join(examplesDir, script)], {
        cwd: repoRoot,
        encoding: "utf8",
      });

      if (result.status !== 0) {
        throw new Error(
          `examples/basic/${script} exited with ${result.status}\n${result.stdout}\n${result.stderr}`,
        );
      }
    }, 30_000);
  }
});
