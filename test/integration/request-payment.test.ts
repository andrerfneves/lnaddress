import { describe, expect, test } from "bun:test";
import {
  CommentTooLongError,
  InvalidCallbackResponseError,
  MissingMandatoryPayerDataError,
  parsePayRequestResponse,
  requestPayment,
} from "../../src";
import { testBolt11Invoice } from "../fixtures/bolt11";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const payRequest = parsePayRequestResponse({
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

      return jsonResponse({
        pr: await testBolt11Invoice(2000, payRequest.metadataHash),
        routes: [],
        verify: "https://example.com/verify/123",
        successAction: { tag: "message", message: "paid" },
      });
    };

    const payment = await requestPayment(payRequest, {
      amountMsat: 2000,
      comment: "thanks ⚡",
      payerData: { name: "Alice" },
      fetch: fetcher,
    });

    expect(payment.type).toBe("bolt11");
    if (payment.type === "bolt11") {
      expect(payment.pr).toBe(await testBolt11Invoice(2000, payRequest.metadataHash));
      expect(payment.verifyUrl).toBe("https://example.com/verify/123");
      expect(payment.successAction).toEqual({ tag: "message", message: "paid" });
    }
  });

  test("overwrites callback amount, comment, and payerdata query params", async () => {
    const payRequestWithQuery = {
      ...payRequest,
      callback: "https://example.com/callback?k1=abc&amount=1&comment=old&payerdata=%7B%7D",
    };

    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.getAll("amount")).toEqual(["2000"]);
      expect(url.searchParams.getAll("comment")).toEqual(["new"]);
      expect(url.searchParams.getAll("payerdata")).toEqual([JSON.stringify({ name: "Alice" })]);

      return jsonResponse({
        pr: await testBolt11Invoice(2000, payRequest.metadataHash),
      });
    };

    await expect(
      requestPayment(payRequestWithQuery, {
        amountMsat: 2000,
        comment: "new",
        payerData: { name: "Alice" },
        fetch: fetcher,
      }),
    ).resolves.toMatchObject({ type: "bolt11" });
  });

  test("returns destination instructions when no pr exists", async () => {
    const fetcher = async () =>
      jsonResponse({
        paymentDestination: "liquid-address",
        paymentURI: "liquidnetwork:liquid-address",
        verify: "https://example.com/verify/liquid",
      });

    const payment = await requestPayment(payRequest, {
      amountMsat: 2000n,
      payerData: { name: "Alice" },
      fetch: fetcher,
    });

    expect(payment).toMatchObject({
      type: "destination",
      paymentDestination: "liquid-address",
      paymentUri: "liquidnetwork:liquid-address",
      verifyUrl: "https://example.com/verify/liquid",
    });
  });

  test("validates comments and mandatory payer data before callback", async () => {
    const fetcher = async () =>
      jsonResponse({ pr: await testBolt11Invoice(2000, payRequest.metadataHash) });

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        comment: "this is too long",
        payerData: { name: "Alice" },
        fetch: fetcher,
      }),
    ).rejects.toThrow(CommentTooLongError);

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        fetch: fetcher,
      }),
    ).rejects.toThrow(MissingMandatoryPayerDataError);

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: null },
        fetch: fetcher,
      }),
    ).rejects.toThrow(MissingMandatoryPayerDataError);
  });

  test("rejects callback errors and missing instructions", async () => {
    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        fetch: async () => jsonResponse({ status: "ERROR", reason: "nope" }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        fetch: async () => jsonResponse({ status: "OK" }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        fetch: async () =>
          jsonResponse({
            status: "FAILED",
            pr: await testBolt11Invoice(2000, payRequest.metadataHash),
          }),
      }),
    ).rejects.toThrow(/status/i);
  });

  test("rejects invalid callback verify URLs", async () => {
    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        fetch: async () =>
          jsonResponse({
            pr: await testBolt11Invoice(2000, payRequest.metadataHash),
            verify: "lightning:lnbc1example",
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        fetch: async () =>
          jsonResponse({
            paymentDestination: "liquid-address",
            verify: "not a url",
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);
  });

  test("validates BOLT11 amount and accepts invoices without metadata hash", async () => {
    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        fetch: async () => jsonResponse({ pr: "not-an-invoice" }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        fetch: async () =>
          jsonResponse({ pr: await testBolt11Invoice(3000, payRequest.metadataHash) }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    // Metadata hash validation is no longer required by default (LUDs PR #234),
    // but strict clients can opt back in.
    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        fetch: async () => jsonResponse({ pr: await testBolt11Invoice(2000, "00".repeat(32)) }),
      }),
    ).resolves.toMatchObject({
      type: "bolt11",
    });

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        validateMetadataHash: true,
        fetch: async () => jsonResponse({ pr: await testBolt11Invoice(2000, "00".repeat(32)) }),
      }),
    ).rejects.toThrow(/description hash/i);

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        fetch: async () =>
          jsonResponse({
            pr: await testBolt11Invoice(2000, payRequest.metadataHash, {
              mismatchedPayeeNode: true,
            }),
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        validateBolt11: false,
        fetch: async () => jsonResponse({ pr: "not-an-invoice" }),
      }),
    ).resolves.toMatchObject({
      type: "bolt11",
      pr: "not-an-invoice",
    });
  });

  test("validates BOLT11 network and expiry policy", async () => {
    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        expectedNetwork: "testnet",
        fetch: async () =>
          jsonResponse({ pr: await testBolt11Invoice(2000, payRequest.metadataHash) }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        expectedNetwork: "bitcoin",
        fetch: async () =>
          jsonResponse({ pr: await testBolt11Invoice(2000, payRequest.metadataHash) }),
      }),
    ).resolves.toMatchObject({ type: "bolt11" });

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        now: 2_000_000,
        fetch: async () =>
          jsonResponse({
            pr: await testBolt11Invoice(2000, payRequest.metadataHash, {
              timestamp: 1_000_000,
              expirySeconds: 60,
            }),
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        validateExpiry: false,
        now: 2_000_000,
        fetch: async () =>
          jsonResponse({
            pr: await testBolt11Invoice(2000, payRequest.metadataHash, {
              timestamp: 1_000_000,
              expirySeconds: 60,
            }),
          }),
      }),
    ).resolves.toMatchObject({ type: "bolt11" });
  });

  test("enforces callback URL safety for PayRequest inputs", async () => {
    const invalidPayRequest = {
      ...payRequest,
      callback: "ftp://example.com/callback",
    };
    let called = false;

    await expect(
      requestPayment(invalidPayRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        fetch: async () => {
          called = true;
          return jsonResponse({ pr: await testBolt11Invoice(2000, payRequest.metadataHash) });
        },
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);
    expect(called).toBe(false);

    const onionPayRequest = {
      ...payRequest,
      callback: "https://abcdefghijklmnop.onion/callback",
    };

    await expect(
      requestPayment(onionPayRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        fetch: async () =>
          jsonResponse({ pr: await testBolt11Invoice(2000, payRequest.metadataHash) }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(onionPayRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        allowOnion: true,
        fetch: async () =>
          jsonResponse({ pr: await testBolt11Invoice(2000, payRequest.metadataHash) }),
      }),
    ).resolves.toMatchObject({ type: "bolt11" });

    const privateNetworkPayRequest = {
      ...payRequest,
      callback: "http://127.0.0.1/callback",
    };

    await expect(
      requestPayment(privateNetworkPayRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        fetch: async () =>
          jsonResponse({ pr: await testBolt11Invoice(2000, payRequest.metadataHash) }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(privateNetworkPayRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        allowPrivateNetwork: true,
        fetch: async () =>
          jsonResponse({ pr: await testBolt11Invoice(2000, payRequest.metadataHash) }),
      }),
    ).resolves.toMatchObject({ type: "bolt11" });
  });

  test("enforces optional provider identity policy", async () => {
    const sourcedPayRequest = {
      ...payRequest,
      sourceUrl: "https://example.com/.well-known/lnurlp/alice",
    };

    await expect(
      requestPayment(
        {
          ...sourcedPayRequest,
          callback: "https://payments.example.net/callback",
        },
        {
          amountMsat: 2000,
          payerData: { name: "Alice" },
          providerPolicy: "same-site",
          fetch: async () =>
            jsonResponse({ pr: await testBolt11Invoice(2000, payRequest.metadataHash) }),
        },
      ),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(
        {
          ...sourcedPayRequest,
          callback: "https://pay.example.com/callback",
        },
        {
          amountMsat: 2000,
          payerData: { name: "Alice" },
          providerPolicy: "same-site",
          fetch: async () =>
            jsonResponse({ pr: await testBolt11Invoice(2000, payRequest.metadataHash) }),
        },
      ),
    ).resolves.toMatchObject({ type: "bolt11" });

    await expect(
      requestPayment(sourcedPayRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        providerPolicy: "same-origin",
        fetch: async () =>
          jsonResponse({
            pr: await testBolt11Invoice(2000, payRequest.metadataHash),
            verify: "https://verify.example.net/verify",
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(sourcedPayRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        providerPolicy: "same-origin",
        fetch: async () =>
          jsonResponse({
            pr: await testBolt11Invoice(2000, payRequest.metadataHash),
            verify: "https://example.com/verify",
          }),
      }),
    ).resolves.toMatchObject({ type: "bolt11" });
  });

  test("forwards network controls when resolving string inputs", async () => {
    const controller = new AbortController();
    const seen: Array<{ input: string; init: RequestInit | undefined }> = [];
    const resolvedPayRequest = {
      tag: "payRequest",
      callback: "https://example.com/callback?k1=abc",
      minSendable: 1000,
      maxSendable: 10_000,
      metadata: '[["text/plain","Test payment"]]',
      commentAllowed: 10,
      payerData: {
        name: { mandatory: true },
      },
    };

    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ input: String(input), init });
      if (seen.length === 1) {
        expect(init?.signal).toBeDefined();
        expect(init?.redirect).toBe("manual");
        return jsonResponse(resolvedPayRequest);
      }

      return jsonResponse({ pr: await testBolt11Invoice(2000, payRequest.metadataHash) });
    };

    await expect(
      requestPayment("alice@example.com", {
        amountMsat: 2000,
        payerData: { name: "Alice" },
        signal: controller.signal,
        timeoutMs: 10_000,
        redirectPolicy: "same-origin",
        fetch: fetcher,
      }),
    ).resolves.toMatchObject({ type: "bolt11" });

    expect(seen.map((entry) => entry.input)).toEqual([
      "https://example.com/.well-known/lnurlp/alice",
      "https://example.com/callback?k1=abc&amount=2000&payerdata=%7B%22name%22%3A%22Alice%22%7D",
    ]);
  });

  test("wraps non-serializable payer data errors", async () => {
    const fetcher = async () =>
      jsonResponse({ pr: await testBolt11Invoice(2000, payRequest.metadataHash) });

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        payerData: { name: "Alice", unsupported: 1n },
        fetch: fetcher,
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);
  });
});
