import { describe, expect, test } from "bun:test";
import {
  parse_lightning_address,
  parse_pay_request_response,
  parse_success_action,
  request_payment,
  validate_comment,
  validate_mandatory_payer_data,
  verify_payment,
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
    const pay_request = parse_pay_request_response(vectors.pay_request);

    expect(pay_request.description).toBe("LUD vector payment");
    expect(pay_request.min_sendable_msat).toBe(1000n);
    expect(pay_request.max_sendable_msat).toBe(100000n);
    expect(() => validate_comment(pay_request, "hello")).not.toThrow();
    expect(() => validate_mandatory_payer_data(pay_request, { name: "Alice" })).not.toThrow();
  });

  test("covers LUD-16 Lightning Address URL construction", async () => {
    const address = parse_lightning_address(vectors.lightning_address);
    expect(address).toEqual({
      username: "alice",
      domain: "example.com",
      address: "alice@example.com",
    });
  });

  test("covers LUD-09 successAction parsing", () => {
    expect(parse_success_action(vectors.success_actions.message)).toEqual({
      tag: "message",
      message: "paid",
    });
    expect(parse_success_action(vectors.success_actions.url)).toEqual({
      tag: "url",
      description: "receipt",
      url: "https://example.com/receipt",
    });
  });

  test("covers payment callback and LUD-21 verification", async () => {
    const pay_request = parse_pay_request_response(vectors.pay_request);
    const payment = await request_payment(pay_request, {
      amount_msat: 2000,
      payer_data: { name: "Alice" },
      fetch: async () =>
        json_response({
          pr: await test_bolt11_invoice(2000, pay_request.metadata_hash),
          verify: "https://example.com/verify?k1=abcdef",
        }),
    });

    expect(payment.type).toBe("bolt11");
    await expect(
      verify_payment(payment, {
        fetch: async () => json_response(vectors.verify),
      }),
    ).resolves.toMatchObject({
      status: "OK",
      settled: true,
    });
  });
});
