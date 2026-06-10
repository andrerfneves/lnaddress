import { describe, expect, test } from "bun:test";
import {
  CommentTooLongError,
  InvalidCallbackResponseError,
  MissingMandatoryPayerDataError,
  parse_pay_request_response,
  request_payment,
} from "../../src";
import { test_bolt11_invoice } from "../fixtures/bolt11";

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
        pr: test_bolt11_invoice(2000, pay_request.metadata_hash),
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
      expect(payment.pr).toBe(test_bolt11_invoice(2000, pay_request.metadata_hash));
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
    const fetcher = async () =>
      json_response({ pr: test_bolt11_invoice(2000, pay_request.metadata_hash) });

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

  test("rejects invalid callback verify URLs", async () => {
    await expect(
      request_payment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () =>
          json_response({
            pr: test_bolt11_invoice(2000, pay_request.metadata_hash),
            verify: "lightning:lnbc1example",
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      request_payment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () =>
          json_response({
            paymentDestination: "liquid-address",
            verify: "not a url",
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);
  });

  test("validates BOLT11 amount and metadata hash by default and can skip the check", async () => {
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
        fetch: async () =>
          json_response({ pr: test_bolt11_invoice(3000, pay_request.metadata_hash) }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      request_payment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () => json_response({ pr: test_bolt11_invoice(2000, "00".repeat(32)) }),
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

  test("enforces callback URL safety for PayRequest inputs", async () => {
    const invalid_pay_request = {
      ...pay_request,
      callback: "ftp://example.com/callback",
    };
    let called = false;

    await expect(
      request_payment(invalid_pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () => {
          called = true;
          return json_response({ pr: test_bolt11_invoice(2000, pay_request.metadata_hash) });
        },
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);
    expect(called).toBe(false);

    const onion_pay_request = {
      ...pay_request,
      callback: "https://abcdefghijklmnop.onion/callback",
    };

    await expect(
      request_payment(onion_pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () =>
          json_response({ pr: test_bolt11_invoice(2000, pay_request.metadata_hash) }),
      }),
    ).resolves.toMatchObject({
      type: "bolt11",
    });
  });
});
