import assert from "node:assert/strict";
import { createRequire } from "node:module";

const esm = await import("../../dist/index.js");
assert.equal(typeof esm.resolve, "function");
assert.equal(typeof esm.pay, "function");
assert.equal(typeof esm.verifyPayment, "function");
assert.equal(esm.isLightningAddress("alice@example.com"), true);

const require = createRequire(import.meta.url);
const cjs = require("../../dist/index.cjs");
assert.equal(typeof cjs.resolve, "function");
assert.equal(typeof cjs.requestPayment, "function");
assert.equal(cjs.isLightningAddress("not-an-address"), false);
