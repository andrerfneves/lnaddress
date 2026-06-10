import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

describe("built package imports", () => {
  test("imports from ESM output", async () => {
    const mod = await import("../../dist/index.js");

    expect(typeof mod.resolve).toBe("function");
    expect(typeof mod.pay).toBe("function");
    expect(typeof mod.verify_payment).toBe("function");
    expect(mod.is_lightning_address("alice@example.com")).toBe(true);
  });

  test("requires from CJS output", () => {
    const require = createRequire(import.meta.url);
    const mod = require("../../dist/index.cjs") as typeof import("../../src");

    expect(typeof mod.resolve).toBe("function");
    expect(typeof mod.request_payment).toBe("function");
    expect(mod.is_lightning_address("not-an-address")).toBe(false);
  });
});
