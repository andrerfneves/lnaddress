import { describe, expect, test } from "bun:test";
import {
  InvalidCallbackResponseError,
  InvalidPayRequestError,
  InvalidRequestPaymentOptionsError,
  parsePayRequestResponse,
  requestPayment,
  validateUnit,
  verifyPayment,
} from "../../src";
import type { PaymentQuote, RequestPaymentOptions, UnitAmount } from "../../src";
import { testBolt11Invoice } from "../fixtures/bolt11";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const baseResponse = {
  tag: "payRequest",
  callback: "https://example.com/callback",
  minSendable: 1000,
  maxSendable: 10_000_000,
  metadata: '[["text/plain","paymentQuote"]]',
};

const usd = {
  code: "USD",
  name: "US Dollar",
  symbol: "$",
  decimals: 2,
  minAmount: "100",
  maxAmount: "100000",
};

const btc = {
  code: "BTC",
  name: "Bitcoin",
  symbol: "₿",
  decimals: 8,
};

const usdt = {
  code: "USDT",
  name: "Tether USD on Liquid",
  symbol: "₮",
  decimals: 6,
  assetId: "liquid-usdt-asset-id",
  minAmount: "1000000",
  maxAmount: "10000000000",
};

function quote(overrides: Partial<PaymentQuote> = {}): PaymentQuote {
  return {
    id: "quote_123",
    expiresAt: "2026-06-30T20:00:00Z",
    requested: { amount: "10000", unit: "USD", raw: { amount: "10000", unit: "USD" } },
    payment: { amount: "10025000", unit: "USDT", raw: { amount: "10025000", unit: "USDT" } },
    receive: { amount: "10000000", unit: "USDT", raw: { amount: "10000000", unit: "USDT" } },
    fees: [
      {
        amount: "25000",
        unit: "USDT",
        description: "Liquid settlement fee",
        raw: { amount: "25000", unit: "USDT", description: "Liquid settlement fee" },
      },
    ],
    raw: {},
    ...overrides,
  };
}

function wireQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: "quote_123",
    expiresAt: "2026-06-30T20:00:00Z",
    requested: { amount: "10000", unit: "USD" },
    payment: { amount: "10025000", unit: "USDT" },
    receive: { amount: "10000000", unit: "USDT" },
    fees: [{ amount: "25000", unit: "USDT", description: "Liquid settlement fee" }],
    ...overrides,
  };
}

describe("paymentQuote units parsing", () => {
  test("parses top-level and paymentOption-specific units", () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      units: [usd, btc],
      paymentOptions: [
        { id: "lightning", type: "lightning" },
        { id: "liquid-usdt", type: "liquid", units: [usd, usdt] },
      ],
    });

    expect(payRequest.units).toEqual([
      { ...usd, raw: usd },
      { ...btc, raw: btc },
    ]);
    expect(payRequest.paymentOptions?.[1]?.units).toEqual([
      { ...usd, raw: usd },
      { ...usdt, raw: usdt },
    ]);
  });

  test("rejects malformed units", () => {
    for (const units of [
      ["USD"],
      [{ decimals: 2 }],
      [{ code: "USD" }],
      [{ ...usd, code: "" }],
      [{ ...usd, decimals: -1 }],
      [{ ...usd, decimals: 1.5 }],
      [{ ...usd, minAmount: "1.5" }],
      [{ ...usd, maxAmount: "abc" }],
      [{ ...usd, minAmount: "1000", maxAmount: "100" }],
      [usd, { ...usd, symbol: "US$" }],
    ]) {
      expect(() => parsePayRequestResponse({ ...baseResponse, units })).toThrow(
        InvalidPayRequestError,
      );
    }
  });

  test("validates effective units and amount bounds", () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      units: [usd],
      paymentOptions: [{ id: "liquid-usdt", type: "liquid", units: [usdt] }],
    });

    expect(() => validateUnit(payRequest, "USD", undefined, { amount: 100 })).not.toThrow();
    expect(() => validateUnit(payRequest, "USD", undefined, { amount: 99 })).toThrow(
      InvalidRequestPaymentOptionsError,
    );
    expect(() => validateUnit(payRequest, "USDT", "liquid-usdt")).not.toThrow();
    expect(() => validateUnit(payRequest, "USD", "liquid-usdt")).toThrow(
      InvalidRequestPaymentOptionsError,
    );
    expect(() => validateUnit(payRequest)).not.toThrow();
  });
});

describe("requestPayment with paymentQuote", () => {
  test("combines unitAmount, receiveUnit, paymentOption, destination instructions, and paymentQuote", async () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      units: [usd],
      paymentOptions: [{ id: "liquid-usdt", type: "liquid", units: [usd, usdt] }],
    });
    const unitAmount: UnitAmount = { amount: 10000n, unit: "USD" };
    const options: RequestPaymentOptions = {
      unitAmount,
      receiveUnit: "USDT",
      paymentOption: "liquid-usdt",
      fetch: async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("amount")).toBe("10000");
        expect(url.searchParams.get("unit")).toBe("USD");
        expect(url.searchParams.get("receiveUnit")).toBe("USDT");
        expect(url.searchParams.get("paymentOption")).toBe("liquid-usdt");
        return jsonResponse({
          status: "OK",
          paymentOption: "liquid-usdt",
          paymentURI: "liquidnetwork:pay?assetid=liquid-usdt-asset-id&amount=10.025",
          paymentQuote: wireQuote(),
          verify: "https://example.com/verify/pay_123",
        });
      },
    };

    const payment = await requestPayment(payRequest, options);

    expect(payment).toMatchObject({
      type: "destination",
      paymentOption: "liquid-usdt",
      paymentUri: "liquidnetwork:pay?assetid=liquid-usdt-asset-id&amount=10.025",
      verifyUrl: "https://example.com/verify/pay_123",
      paymentQuote: {
        id: "quote_123",
        requested: { amount: "10000", unit: "USD" },
        payment: { amount: "10025000", unit: "USDT" },
        receive: { amount: "10000000", unit: "USDT" },
        fees: [{ amount: "25000", unit: "USDT", description: "Liquid settlement fee" }],
      },
    });
  });

  test("supports amountMsat with receiveUnit while keeping amount in msats", async () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, units: [usd] });
    let capturedUrl: URL | undefined;

    const payment = await requestPayment(payRequest, {
      amountMsat: 25000,
      receiveUnit: "USD",
      validateBolt11: false,
      fetch: async (input) => {
        capturedUrl = new URL(String(input));
        return jsonResponse({
          pr: "lnbc1...",
          paymentQuote: wireQuote({
            requested: { amount: "25000", unit: "msat" },
            payment: { amount: "25000", unit: "msat" },
            receive: { amount: "500", unit: "USD" },
            fees: [],
          }),
        });
      },
    });

    expect(capturedUrl?.searchParams.get("amount")).toBe("25000");
    expect(capturedUrl?.searchParams.has("unit")).toBe(false);
    expect(capturedUrl?.searchParams.get("receiveUnit")).toBe("USD");
    expect(payment.type).toBe("bolt11");
    expect(payment.paymentQuote?.requested).toMatchObject({ amount: "25000", unit: "msat" });
  });

  test("rejects unsupported units, out-of-range amounts, and missing required paymentQuote", async () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, units: [usd] });
    let called = false;

    await expect(
      requestPayment(payRequest, {
        unitAmount: { amount: 10000, unit: "EUR" },
        fetch: async () => {
          called = true;
          return jsonResponse({ status: "OK", paymentDestination: "ignored" });
        },
      }),
    ).rejects.toThrow(InvalidRequestPaymentOptionsError);
    expect(called).toBe(false);

    await expect(
      requestPayment(payRequest, {
        unitAmount: { amount: 99, unit: "USD" },
        fetch: async () => jsonResponse({ status: "OK", paymentDestination: "ignored" }),
      }),
    ).rejects.toThrow(InvalidRequestPaymentOptionsError);

    await expect(
      requestPayment(payRequest, {
        unitAmount: { amount: 10000, unit: "USD" },
        fetch: async () => jsonResponse({ status: "OK", paymentDestination: "bc1q..." }),
      }),
    ).rejects.toThrow(/paymentQuote/i);
  });

  test("rejects malformed or mismatched paymentQuote objects", async () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, units: [usd] });

    await expect(
      requestPayment(payRequest, {
        unitAmount: { amount: 10000, unit: "USD" },
        fetch: async () =>
          jsonResponse({
            status: "OK",
            paymentDestination: "bc1q...",
            paymentQuote: wireQuote({ requested: { amount: "9999", unit: "USD" } }),
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(payRequest, {
        unitAmount: { amount: 10000, unit: "USD" },
        fetch: async () =>
          jsonResponse({
            status: "OK",
            paymentDestination: "bc1q...",
            paymentQuote: wireQuote({ payment: { amount: "1.5", unit: "USD" } }),
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);
  });

  test("rejects missing or mismatched receive quotes when receiveUnit is requested", async () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      units: [usd],
      paymentOptions: [{ id: "liquid-usdt", type: "liquid", units: [usd, usdt] }],
    });

    await expect(
      requestPayment(payRequest, {
        unitAmount: { amount: 10000, unit: "USD" },
        receiveUnit: "USDT",
        paymentOption: "liquid-usdt",
        fetch: async () =>
          jsonResponse({
            status: "OK",
            paymentURI: "liquidnetwork:pay?assetid=liquid-usdt-asset-id&amount=10.025",
            paymentQuote: wireQuote({ receive: undefined }),
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);

    await expect(
      requestPayment(payRequest, {
        unitAmount: { amount: 10000, unit: "USD" },
        receiveUnit: "USDT",
        paymentOption: "liquid-usdt",
        fetch: async () =>
          jsonResponse({
            status: "OK",
            paymentURI: "liquidnetwork:pay?assetid=liquid-usdt-asset-id&amount=10.025",
            paymentQuote: wireQuote({ receive: { amount: "10000000", unit: "USD" } }),
          }),
      }),
    ).rejects.toThrow(InvalidCallbackResponseError);
  });

  test("validates BOLT11 invoice amount against paymentQuote.payment when quoting non-msat input", async () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, units: [usd] });
    const okQuote = wireQuote({ payment: { amount: "100500", unit: "msat" } });

    await expect(
      requestPayment(payRequest, {
        unitAmount: { amount: 10000, unit: "USD" },
        fetch: async () =>
          jsonResponse({
            pr: await testBolt11Invoice(100500, payRequest.metadataHash),
            paymentQuote: okQuote,
          }),
      }),
    ).resolves.toMatchObject({ type: "bolt11", paymentQuote: { payment: { amount: "100500" } } });

    await expect(
      requestPayment(payRequest, {
        unitAmount: { amount: 10000, unit: "USD" },
        fetch: async () =>
          jsonResponse({
            pr: await testBolt11Invoice(100000, payRequest.metadataHash),
            paymentQuote: okQuote,
          }),
      }),
    ).rejects.toThrow(/paymentQuote\.payment/i);
  });

  test("parses optional paymentQuote on normal msat callbacks", async () => {
    const payRequest = parsePayRequestResponse(baseResponse);
    const payment = await requestPayment(payRequest, {
      amountMsat: 5000,
      validateBolt11: false,
      fetch: async () =>
        jsonResponse({
          pr: "lnbc1...",
          paymentQuote: wireQuote({
            requested: { amount: "5000", unit: "msat" },
            payment: { amount: "5000", unit: "msat" },
          }),
        }),
    });

    expect(payment.type).toBe("bolt11");
    expect(payment.paymentQuote?.requested).toMatchObject({ amount: "5000", unit: "msat" });
  });
});

describe("verifyPayment with paymentQuote", () => {
  test("parses optional paymentQuote echoes without changing verify semantics", async () => {
    const result = await verifyPayment("https://example.com/verify", {
      fetch: async () =>
        jsonResponse({
          status: "OK",
          settled: true,
          paymentOption: "liquid-usdt",
          paymentReference: "txid123",
          paymentQuote: wireQuote(),
        }),
    });

    expect(result.status).toBe("OK");
    expect(result.settled).toBe(true);
    expect(result.paymentQuote?.id).toBe("quote_123");
  });
});

void quote;
