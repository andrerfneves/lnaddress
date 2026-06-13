import { describe, expect, test } from "bun:test";
import {
  CommentTooLongError,
  InvalidCallbackResponseError,
  MissingMandatoryPayerDataError,
  parsePayRequestResponse,
  requestPayment,
} from "../../src";
import { test_bolt11_invoice } from "../fixtures/bolt11";

function json_response(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const pay_request = parsePayRequestResponse({
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

describe("requestPayment", () => {
  test("builds callback URLs with amount, comment, and payerdata", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("k1")).toBe("abc");
      expect(url.searchParams.get("amount")).toBe("2000");
      expect(url.searchParams.get("comment")).toBe("thanks ⚡");
      expect(url.searchParams.get("payerdata")).toBe(JSON.stringify({ name: "Alice" }));

      return json_response({
        pr: await test_bolt11_invoice(2000, pay_request.metadata_hash),
        routes: [],
        verify: "https://example.com/verify/123",
        successAction: { tag: "message", message: "paid" },
      });
    };

    const payment = await requestPayment(pay_request, {
      amount_msat: 2000,
      comment: "thanks ⚡",
      payer_data: { name: "Alice" },
      fetch: fetcher,
    });

    expect(payment.type).toBe("bolt11");
    if (payment.type === "bolt11") {
      expect(payment.pr).toBe(await test_bolt11_invoice(2000, pay_request.metadata_hash));
      expect(payment.verify_url).toBe("https://example.com/verify/123");
      expect(payment.success_action).toEqual({ tag: "message", message: "paid" });
    }
  });

  test("overwrites callback amount, comment, and payerdata query params", async () => {
    const pay_request_with_query = {
      ...pay_request,
      callback: "https://example.com/callback?k1=abc&amount=1&comment=old&payerdata=%7B%7D",
    };

    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.getAll("amount")).toEqual(["2000"]);
      expect(url.searchParams.getAll("comment")).toEqual(["new"]);
      expect(url.searchParams.getAll("payerdata")).toEqual([JSON.stringify({ name: "Alice" })]);

      return json_response({
        pr: await test_bolt11_invoice(2000, pay_request.metadata_hash),
      });
    };

    await expect(
      requestPayment(pay_request_with_query, {
        amount_msat: 2000,
        comment: "new",
        payer_data: { name: "Alice" },
        fetch: fetcher,
      }),
    ).resolves.toMatchObject({ type: "bolt11" });
  });

  test("returns destination instructions when no pr exists", async () => {
    const fetcher = async () =>
      json_response({
        paymentDestination: "liquid-address",
        paymentURI: "liquidnetwork:liquid-address",
        verify: "https://example.com/verify/liquid",
      });

    const payment = await requestPayment(pay_request, {
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
      json_response({ pr: await test_bolt11_invoice(2000, pay_request.metadata_hash) });

    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        comment: "this is too long",
        payer_data: { name: "Alice" },
        fetch: fetcher,
      }),
    ).rejects.toThrow(CommentTooLongError);

    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        fetch: fetcher,
      }),
    ).rejects.toThrow(MissingMandatoryPayerDataError);

    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: null },
        fetch: fetcher,
      }),
    ).rejects.toThrow(MissingMandatoryPayerDataError);
  });

  test("rejects callback errors and missing instructions", async () => {
    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () => json_response({ status: "ERROR", reason: "nope" }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () => json_response({ status: "OK" }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);
  });

  test("rejects invalid callback verify URLs", async () => {
    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () =>
          json_response({
            pr: await test_bolt11_invoice(2000, pay_request.metadata_hash),
            verify: "lightning:lnbc1example",
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(pay_request, {
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
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () => json_response({ pr: "not-an-invoice" }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () =>
          json_response({ pr: await test_bolt11_invoice(3000, pay_request.metadata_hash) }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () => json_response({ pr: await test_bolt11_invoice(2000, "00".repeat(32)) }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () =>
          json_response({
            pr: await test_bolt11_invoice(2000, pay_request.metadata_hash, {
              mismatched_payee_node: true,
            }),
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(pay_request, {
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

  test("validates BOLT11 network and expiry policy", async () => {
    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        expected_network: "testnet",
        fetch: async () =>
          json_response({ pr: await test_bolt11_invoice(2000, pay_request.metadata_hash) }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        expected_network: "bitcoin",
        fetch: async () =>
          json_response({ pr: await test_bolt11_invoice(2000, pay_request.metadata_hash) }),
      }),
    ).resolves.toMatchObject({ type: "bolt11" });

    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        now: 2_000_000,
        fetch: async () =>
          json_response({
            pr: await test_bolt11_invoice(2000, pay_request.metadata_hash, {
              timestamp: 1_000_000,
              expiry_seconds: 60,
            }),
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        validate_expiry: false,
        now: 2_000_000,
        fetch: async () =>
          json_response({
            pr: await test_bolt11_invoice(2000, pay_request.metadata_hash, {
              timestamp: 1_000_000,
              expiry_seconds: 60,
            }),
          }),
      }),
    ).resolves.toMatchObject({ type: "bolt11" });
  });

  test("enforces callback URL safety for PayRequest inputs", async () => {
    const invalid_pay_request = {
      ...pay_request,
      callback: "ftp://example.com/callback",
    };
    let called = false;

    await expect(
      requestPayment(invalid_pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () => {
          called = true;
          return json_response({ pr: await test_bolt11_invoice(2000, pay_request.metadata_hash) });
        },
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);
    expect(called).toBe(false);

    const onion_pay_request = {
      ...pay_request,
      callback: "https://abcdefghijklmnop.onion/callback",
    };

    await expect(
      requestPayment(onion_pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        fetch: async () =>
          json_response({ pr: await test_bolt11_invoice(2000, pay_request.metadata_hash) }),
      }),
    ).resolves.toMatchObject({
      type: "bolt11",
    });
  });

  test("enforces optional provider identity policy", async () => {
    const sourced_pay_request = {
      ...pay_request,
      source_url: "https://example.com/.well-known/lnurlp/alice",
    };

    await expect(
      requestPayment(
        {
          ...sourced_pay_request,
          callback: "https://payments.example.net/callback",
        },
        {
          amount_msat: 2000,
          payer_data: { name: "Alice" },
          provider_policy: "same-site",
          fetch: async () =>
            json_response({ pr: await test_bolt11_invoice(2000, pay_request.metadata_hash) }),
        },
      ),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(
        {
          ...sourced_pay_request,
          callback: "https://pay.example.com/callback",
        },
        {
          amount_msat: 2000,
          payer_data: { name: "Alice" },
          provider_policy: "same-site",
          fetch: async () =>
            json_response({ pr: await test_bolt11_invoice(2000, pay_request.metadata_hash) }),
        },
      ),
    ).resolves.toMatchObject({ type: "bolt11" });

    await expect(
      requestPayment(sourced_pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        provider_policy: "same-origin",
        fetch: async () =>
          json_response({
            pr: await test_bolt11_invoice(2000, pay_request.metadata_hash),
            verify: "https://verify.example.net/verify",
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(sourced_pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice" },
        provider_policy: "same-origin",
        fetch: async () =>
          json_response({
            pr: await test_bolt11_invoice(2000, pay_request.metadata_hash),
            verify: "https://example.com/verify",
          }),
      }),
    ).resolves.toMatchObject({ type: "bolt11" });
  });

  test("wraps non-serializable payer data errors", async () => {
    const fetcher = async () =>
      json_response({ pr: await test_bolt11_invoice(2000, pay_request.metadata_hash) });

    await expect(
      requestPayment(pay_request, {
        amount_msat: 2000,
        payer_data: { name: "Alice", unsupported: 1n },
        fetch: fetcher,
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);
  });
});
