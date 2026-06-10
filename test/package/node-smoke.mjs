import assert from "node:assert/strict";
import { createRequire } from "node:module";

const esm = await import("../../dist/index.js");
assert.equal(typeof esm.resolve, "function");
assert.equal(typeof esm.pay, "function");
assert.equal(typeof esm.verify_payment, "function");
assert.equal(esm.is_lightning_address("alice@example.com"), true);

const require = createRequire(import.meta.url);
const cjs = require("../../dist/index.cjs");
assert.equal(typeof cjs.resolve, "function");
assert.equal(typeof cjs.request_payment, "function");
assert.equal(cjs.is_lightning_address("not-an-address"), false);
