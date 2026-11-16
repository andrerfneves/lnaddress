import { describe, expect, test } from "bun:test";
import { InvalidCallbackResponseError } from "../../src";
import { decodeBolt11 } from "../../src/lightning/bolt11";
import {
  alternateTestNodePubkey,
  testBolt11Invoice,
  testNodePubkey,
  testPaymentHash,
} from "../fixtures/bolt11";

const metadataHash = "ab".repeat(32);

describe("decodeBolt11", () => {
  test.each([
    ["bc", "bitcoin"],
    ["tb", "testnet"],
    ["tbs", "signet"],
    ["bcrt", "regtest"],
  ] as const)("maps the ln%s prefix to %s", async (prefix, network) => {
    const invoice = await decodeBolt11(
      await testBolt11Invoice(2000, metadataHash, { network: prefix }),
    );
    expect(invoice.network).toBe(network);
    expect(invoice.amountMsat).toBe(2000n);
  });

  test.each([
    [
      "lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql",
      "bitcoin",
      undefined,
      3600,
    ],
    [
      "lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh",
      "bitcoin",
      250_000_000n,
      60,
    ],
    [
      "lntb20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygshp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqfpp3x9et2e20v6pu37c5d9vax37wxq72un989qrsgqdj545axuxtnfemtpwkc45hx9d2ft7x04mt8q7y6t0k2dge9e7h8kpy9p34ytyslj3yu569aalz2xdk8xkd7ltxqld94u8h2esmsmacgpghe9k8",
      "testnet",
      2_000_000_000n,
      3600,
    ],
  ] as const)("decodes BOLT11 spec vector %#", async (pr, network, amountMsat, expirySeconds) => {
    const invoice = await decodeBolt11(pr);
    expect(invoice.network).toBe(network);
    expect(invoice.amountMsat).toBe(amountMsat);
    expect(invoice.expirySeconds).toBe(expirySeconds);
    expect(invoice.timestamp).toBe(1496314658);
    expect(invoice.paymentHash).toBe(
      "0001020304050607080900010203040506070809000102030405060708090102",
    );
    expect(invoice.payeeNodeId).toBe(
      "03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad",
    );
    expect(invoice.payeeNodeIdSource).toBe("signature");
  });

  test("rejects simnet (lnsb) and unknown prefixes", async () => {
    for (const prefix of ["sb", "xx"]) {
      const pr = await testBolt11Invoice(2000, metadataHash, { network: prefix });
      await expect(decodeBolt11(pr)).rejects.toThrow(/network prefix/);
    }
  });

  test("exposes payment hash, description hash, expiry, and payee", async () => {
    const invoice = await decodeBolt11(
      await testBolt11Invoice(2000, metadataHash, { timestamp: 1_700_000_000, expirySeconds: 600 }),
    );
    expect(invoice).toMatchObject({
      paymentHash: testPaymentHash,
      descriptionHash: metadataHash,
      timestamp: 1_700_000_000,
      expirySeconds: 600,
      payeeNodeId: testNodePubkey,
      payeeNodeIdSource: "n",
    });
  });

  test("requires a payment hash", async () => {
    const pr = await testBolt11Invoice(2000, metadataHash, { omitPaymentHash: true });
    await expect(decodeBolt11(pr)).rejects.toThrow(/payment hash is missing/);
  });

  test("recovers the payee from the signature when n is absent", async () => {
    const invoice = await decodeBolt11(
      await testBolt11Invoice(2000, metadataHash, { omitPayeeNode: true, signer: "alternate" }),
    );
    expect(invoice.payeeNodeId).toBe(alternateTestNodePubkey);
    expect(invoice.payeeNodeIdSource).toBe("signature");
  });

  test("rejects a signature that does not match the n field", async () => {
    const pr = await testBolt11Invoice(2000, metadataHash, { mismatchedPayeeNode: true });
    await expect(decodeBolt11(pr)).rejects.toThrow(/does not match payee node id/);
  });

  test("rejects tampered invoices and mixed case", async () => {
    const pr = await testBolt11Invoice(2000, metadataHash);
    const tampered = `${pr.slice(0, -1)}${pr.endsWith("q") ? "p" : "q"}`;
    await expect(decodeBolt11(tampered)).rejects.toThrow(InvalidCallbackResponseError);
    await expect(decodeBolt11(`${pr.slice(0, 4).toUpperCase()}${pr.slice(4)}`)).rejects.toThrow(
      /mix upper and lower case/,
    );
  });
});
