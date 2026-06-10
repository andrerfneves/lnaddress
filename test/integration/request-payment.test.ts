import { describe, expect, test } from "bun:test";
import {
  CommentTooLongError,
  InvalidCallbackResponseError,
  MissingMandatoryPayerDataError,
  parse_pay_request_response,
  request_payment,
} from "../../src";

function json_response(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const pay_request = parse_pay_request_response({
  tag: "payRequest",
  callback: "https://example.com/callback?k1=abc",
  minSendable: 1000,
  maxSendable: 10_000,
  metadata: '[["text/plain","Test payment"]]',
  commentAllowed: 10,
  payerData: {
    name: { mandatory: true },
  },
});

describe("request_payment", () => {
  test("builds callback URLs with amount, comment, and payerdata", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("k1")).toBe("abc");
      expect(url.searchParams.get("amount")).toBe("2000");
      expect(url.searchParams.get("comment")).toBe("thanks");
      expect(url.searchParams.get("payerdata")).toBe(JSON.stringify({ name: "Alice" }));

      return json_response({
        pr: "lnbc1qqqqqqqqqqqqqq",
        routes: [],
        verify: "https://example.com/verify/123",
        successAction: { tag: "message", message: "paid" },
      });
    };

    const payment = await request_payment(pay_request, {
      amount_msat: 2000,
      comment: "thanks",
      payer_data: { name: "Alice" },
      fetch: fetcher,
    });

    expect(payment.type).toBe("bolt11");
    if (payment.type === "bolt11") {
      expect(payment.pr).toBe("lnbc1qqqqqqqqqqqqqq");
      expect(payment.verify_url).toBe("https://example.com/verify/123");
      expect(payment.success_action).toEqual({ tag: "message", message: "paid" });
    }
  });

  test("returns destination instructions when no pr exists", async () => {
    const fetcher = async () =>
      json_response({
        paymentDestination: "liquid-address",
        paymentURI: "liquidnetwork:liquid-address",
        verify: "https://example.com/verify/liquid",
      });

    const payment = await request_payment(pay_request, {
      amount_msat: 2000n,
      payer_data: { name: "Alice" },
      fetch: fetcher,
    });

    expect(payment).toMatchObject({
      type: "destination",
      payment_destination: "liquid-address",
      payment_uri: "liquidnetwork:liquid-address",
      verify_url: "https://example.com/verify/liquid",
    });
  });

  test("validates comments and mandatory payer data before callback", async () => {
    const fetcher = async () => json_response({ pr: "lnbc1qqqqqqqqqqqqqq" });

    await expect(
      request_payment(pay_request, {
        amount_msat: 2000,
        comment: "this is too long",
        payer_data: { name: "Alice" },
        fetch: fetcher,
      }),
    ).rejects.toThrow(CommentTooLongError);

    await expect(
      request_payment(pay_request, {
        amount_msat: 2000,
        fetch: fetcher,
      }),
    ).rejects.toThrow(MissingMandatoryPayerDataError);
  });

  test("rejects callback errors and missing instructions", async () => {
    await expect(
      request_payment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () => json_response({ status: "ERROR", reason: "nope" }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      request_payment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () => json_response({ status: "OK" }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);
  });

  test("validates BOLT11 shape by default and can skip the shape check", async () => {
    await expect(
      request_payment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () => json_response({ pr: "not-an-invoice" }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      request_payment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        validate_bolt11: false,
        fetch: async () => json_response({ pr: "not-an-invoice" }),
      }),
    ).resolves.toMatchObject({
      type: "bolt11",
      pr: "not-an-invoice",
    });
  });
});
