import { describe, expect, test } from "bun:test";
import {
  parseLightningAddress,
  parsePayRequestResponse,
  parseSuccessAction,
  requestPayment,
  validateComment,
  validateMandatoryPayerData,
  verifyPayment,
} from "../../src";
import { testBolt11Invoice } from "../fixtures/bolt11";

type LudVectors = {
  lightningAddress: string;
  payRequest: Record<string, unknown>;
  successActions: {
    message: Record<string, unknown>;
    url: Record<string, unknown>;
  };
  verify: Record<string, unknown>;
};

const vectors = (await Bun.file(
  new URL("../vectors/lud-vectors.json", import.meta.url),
).json()) as LudVectors;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("LUD compliance vectors", () => {
  test("covers LUD-06 payRequest, LUD-12 comments, and LUD-18 payerData", () => {
    const payRequest = parsePayRequestResponse(vectors.payRequest);

    expect(payRequest.description).toBe("LUD vector payment");
    expect(payRequest.minSendableMsat).toBe(1000n);
    expect(payRequest.maxSendableMsat).toBe(100000n);
    expect(() => validateComment(payRequest, "hello")).not.toThrow();
    expect(() => validateMandatoryPayerData(payRequest, { name: "Alice" })).not.toThrow();
  });

  test("covers LUD-16 Lightning Address URL construction", async () => {
    const address = parseLightningAddress(vectors.lightningAddress);
    expect(address).toEqual({
      username: "alice",
      domain: "example.com",
      address: "alice@example.com",
    });
  });

  test("covers LUD-09 successAction parsing", () => {
    expect(parseSuccessAction(vectors.successActions.message)).toEqual({
      tag: "message",
      message: "paid",
    });
    expect(parseSuccessAction(vectors.successActions.url)).toEqual({
      tag: "url",
      description: "receipt",
      url: "https://example.com/receipt",
    });
  });

  test("covers payment callback and LUD-21 verification", async () => {
    const payRequest = parsePayRequestResponse(vectors.payRequest);
    const payment = await requestPayment(payRequest, {
      amountMsat: 2000,
      payerData: { name: "Alice" },
      fetch: async () =>
        jsonResponse({
          pr: await testBolt11Invoice(2000, payRequest.metadataHash),
          verify: "https://example.com/verify?k1=abcdef",
        }),
    });

    expect(payment.type).toBe("bolt11");
    await expect(
      verifyPayment(payment, {
        fetch: async () => jsonResponse(vectors.verify),
      }),
    ).resolves.toMatchObject({
      status: "OK",
      settled: true,
    });
  });
});
