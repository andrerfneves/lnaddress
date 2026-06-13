import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

describe("built package imports", () => {
  test("imports from ESM output", async () => {
    const mod = await import("../../dist/index.js");

    expect(typeof mod.resolve).toBe("function");
    expect(typeof mod.pay).toBe("function");
    expect(typeof mod.verifyPayment).toBe("function");
    expect(mod.isLightningAddress("alice@example.com")).toBe(true);
  });

  test("requires from CJS output", () => {
    const require = createRequire(import.meta.url);
    const mod = require("../../dist/index.cjs") as typeof import("../../src");

    expect(typeof mod.resolve).toBe("function");
    expect(typeof mod.requestPayment).toBe("function");
    expect(mod.isLightningAddress("not-an-address")).toBe(false);
  });
});
