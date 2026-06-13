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
import { test_bolt11_invoice } from "../fixtures/bolt11";

type LudVectors = {
  lightning_address: string;
  pay_request: Record<string, unknown>;
  success_actions: {
    message: Record<string, unknown>;
    url: Record<string, unknown>;
  };
  verify: Record<string, unknown>;
};

const vectors = (await Bun.file(
  new URL("../vectors/lud-vectors.json", import.meta.url),
).json()) as LudVectors;

function json_response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("LUD compliance vectors", () => {
  test("covers LUD-06 payRequest, LUD-12 comments, and LUD-18 payerData", () => {
    const pay_request = parsePayRequestResponse(vectors.pay_request);

    expect(pay_request.description).toBe("LUD vector payment");
    expect(pay_request.minSendableMsat).toBe(1000n);
    expect(pay_request.maxSendableMsat).toBe(100000n);
    expect(() => validateComment(pay_request, "hello")).not.toThrow();
    expect(() => validateMandatoryPayerData(pay_request, { name: "Alice" })).not.toThrow();
  });

  test("covers LUD-16 Lightning Address URL construction", async () => {
    const address = parseLightningAddress(vectors.lightning_address);
    expect(address).toEqual({
      username: "alice",
      domain: "example.com",
      address: "alice@example.com",
    });
  });

  test("covers LUD-09 successAction parsing", () => {
    expect(parseSuccessAction(vectors.success_actions.message)).toEqual({
      tag: "message",
      message: "paid",
    });
    expect(parseSuccessAction(vectors.success_actions.url)).toEqual({
      tag: "url",
      description: "receipt",
      url: "https://example.com/receipt",
    });
  });

  test("covers payment callback and LUD-21 verification", async () => {
    const pay_request = parsePayRequestResponse(vectors.pay_request);
    const payment = await requestPayment(pay_request, {
      amountMsat: 2000,
      payerData: { name: "Alice" },
      fetch: async () =>
        json_response({
          pr: await test_bolt11_invoice(2000, pay_request.metadataHash),
          verify: "https://example.com/verify?k1=abcdef",
        }),
    });

    expect(payment.type).toBe("bolt11");
    await expect(
      verifyPayment(payment, {
        fetch: async () => json_response(vectors.verify),
      }),
    ).resolves.toMatchObject({
      status: "OK",
      settled: true,
    });
  });
});
