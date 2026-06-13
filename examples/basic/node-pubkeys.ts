import { NodePubkeyMismatchError, parsePayRequestResponse, requestPayment } from "../../src";
import {
  alternateTestNodePubkey,
  testBolt11Invoice,
  testNodePubkey,
} from "../../test/fixtures/bolt11";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const payRequest = parsePayRequestResponse({
  tag: "payRequest",
  callback: "https://example.com/callback?k1=abc",
  minSendable: 1_000,
  maxSendable: 100_000,
  metadata: '[["text/plain","nodePubkeys demo"]]',
  nodePubkeys: [{ pubkey: testNodePubkey }],
});

const payment = await requestPayment(payRequest, {
  amountMsat: 25_000,
  fetch: async () =>
    json({
      status: "OK",
      pr: await testBolt11Invoice(25_000, payRequest.metadataHash, { signer: "alternate" }),
    }),
});

if (payment.type === "bolt11" && payment.nodePubkeyVerification?.status === "mismatch") {
  console.warn(payment.nodePubkeyVerification.warning);
  console.warn({
    expected: payment.nodePubkeyVerification.expectedPubkeys,
    actual: payment.nodePubkeyVerification.payeeNodeId,
    actualLabel: alternateTestNodePubkey,
  });
}

try {
  await requestPayment(payRequest, {
    amountMsat: 25_000,
    nodePubkeyPolicy: "enforce",
    fetch: async () =>
      json({
        status: "OK",
        pr: await testBolt11Invoice(25_000, payRequest.metadataHash, { signer: "alternate" }),
      }),
  });
} catch (error) {
  if (error instanceof NodePubkeyMismatchError) {
    console.warn("Strict nodePubkeys policy blocked the invoice mismatch.");
  } else {
    throw error;
  }
}
