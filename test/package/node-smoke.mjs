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

// Exercise the crypto path (bech32, sha256, secp256k1 signature recovery) on this
// Node version with a BOLT11 specification test vector.
const specInvoice =
  "lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh";

for (const mod of [esm, cjs]) {
  const payRequest = mod.parsePayRequestResponse({
    tag: "payRequest",
    callback: "https://example.com/callback",
    minSendable: 1000,
    maxSendable: 1_000_000_000,
    metadata: '[["text/plain","Node smoke"]]',
    nodePubkeys: [{ pubkey: "03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad" }],
  });
  const payment = await mod.requestPayment(payRequest, {
    amountMsat: 250_000_000,
    validateExpiry: false,
    fetch: async () =>
      new Response(JSON.stringify({ pr: specInvoice }), {
        headers: { "content-type": "application/json" },
      }),
  });
  assert.equal(payment.type, "bolt11");
  assert.equal(payment.nodePubkeyVerification?.status, "verified");
}

console.log(`node ${process.version}: package smoke test passed`);
