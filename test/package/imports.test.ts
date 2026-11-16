import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");
const tmpRoots: string[] = [];

function run(
  command: string,
  args: string[],
  cwd: string,
  envOverrides: NodeJS.ProcessEnv = {},
): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...envOverrides },
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }

  return result.stdout.trim();
}

function packFixture(): { fixture: string; packageDir: string } {
  const tmpRoot = join(tmpdir(), `lnaddress-package-${crypto.randomUUID()}`);
  tmpRoots.push(tmpRoot);
  mkdirSync(tmpRoot, { recursive: true });

  const packJson = run(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", tmpRoot],
    repoRoot,
    { npm_config_dry_run: "false" },
  );
  const [packed] = JSON.parse(packJson) as Array<{ filename: string }>;
  if (!packed?.filename) {
    throw new Error(`npm pack did not return a tarball: ${packJson}`);
  }

  const tarball = join(tmpRoot, packed.filename);
  const extracted = join(tmpRoot, "extracted");
  mkdirSync(extracted, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", extracted], repoRoot);

  const packageDir = join(extracted, "package");
  const fixture = join(tmpRoot, "fixture");
  const nodeModules = join(fixture, "node_modules");
  const installed = join(nodeModules, "lnaddress");
  mkdirSync(nodeModules, { recursive: true });

  // Copy rather than symlink: Node resolves dependencies from a module's real path,
  // so the installed package must sit next to its dependencies like a real install.
  cpSync(packageDir, installed, { recursive: true });

  // Provide only the declared runtime dependencies, so a missing entry in
  // package.json "dependencies" fails here instead of resolving from the repo.
  const { dependencies = {} } = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  for (const name of Object.keys(dependencies)) {
    const target = join(nodeModules, name);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(join(repoRoot, "node_modules", name), target, "dir");
  }

  return { fixture, packageDir };
}

afterEach(() => {
  for (const tmpRoot of tmpRoots.splice(0)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe("built package imports", () => {
  test("imports from ESM output", async () => {
    const mod = await import("../../dist/index.js");

    expect(typeof mod.resolve).toBe("function");
    expect(typeof mod.fetchServiceKeys).toBe("function");
    expect(typeof mod.pay).toBe("function");
    expect(typeof mod.verifyPayment).toBe("function");
    expect(mod.isLightningAddress("alice@example.com")).toBe(true);
  });

  test("requires from CJS output", () => {
    const mod = require("../../dist/index.cjs") as typeof import("../../src");

    expect(typeof mod.resolve).toBe("function");
    expect(typeof mod.requestPayment).toBe("function");
    expect(typeof mod.parseServiceKeysResponse).toBe("function");
    expect(mod.isLightningAddress("not-an-address")).toBe(false);
  });

  test("packed tarball exports work from an installed fixture", () => {
    const { fixture, packageDir } = packFixture();
    const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      exports?: Record<string, unknown>;
      files?: string[];
    };

    expect(packageJson.files).toContain("dist");
    expect(packageJson.exports?.["."]).toBeDefined();
    expect(packageJson.exports?.["./package.json"]).toBeDefined();

    const esmFile = join(fixture, "esm.mjs");
    writeFileSync(
      esmFile,
      [
        'import { isLightningAddress, serviceKeysUrl, validatePaymentOption, validateUnit } from "lnaddress";',
        'if (!isLightningAddress("alice@example.com")) throw new Error("bad esm export");',
        'if (typeof validatePaymentOption !== "function") throw new Error("missing validatePaymentOption");',
        'if (typeof validateUnit !== "function") throw new Error("missing validateUnit");',
        'if (serviceKeysUrl("example.com").pathname !== "/.well-known/lnurl-service") throw new Error("bad serviceKeysUrl export");',
      ].join("\n"),
    );

    const cjsFile = join(fixture, "cjs.cjs");
    writeFileSync(
      cjsFile,
      [
        'const { fetchServiceKeys, isLightningAddress, requestPayment } = require("lnaddress");',
        'if (isLightningAddress("not-an-address")) throw new Error("bad cjs export");',
        'if (typeof requestPayment !== "function") throw new Error("missing requestPayment");',
        'if (typeof fetchServiceKeys !== "function") throw new Error("missing fetchServiceKeys");',
      ].join("\n"),
    );

    // Run under Node, not Bun: Bun would auto-install anything missing from node_modules.
    run("node", [esmFile], fixture);
    run("node", [cjsFile], fixture);
    // A cold `npm pack` can take well over bun's 5s default test timeout.
  }, 60_000);
});
