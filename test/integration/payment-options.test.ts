import { describe, expect, test } from "bun:test";
import {
  InvalidPaymentOptionError,
  parsePayRequestResponse,
  requestPayment,
  validatePaymentOption,
  verifyPayment,
} from "../../src";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const basePayRequest = {
  tag: "payRequest",
  callback: "https://example.com/callback",
  minSendable: 1000,
  maxSendable: 100_000,
  metadata: '[["text/plain","Test"]]',
};

const paymentOptions = [
  { id: "lightning", type: "lightning", available: true },
  { id: "bolt12", type: "bolt12", available: true },
  { id: "onchain", type: "onchain", available: true },
  { id: "liquid", type: "liquid", available: false },
  { id: "arkade", type: "arkade", available: true },
  { id: "spark", type: "spark", available: true },
  { id: "bark", type: "bark", available: true },
];

describe("paymentOptions parsing", () => {
  test("parses paymentOptions from payRequest", () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      paymentOptions,
    });

    expect(payRequest.paymentOptions).toHaveLength(7);
    expect(payRequest.paymentOptions?.[0]).toEqual({
      id: "lightning",
      type: "lightning",
      available: true,
      raw: { id: "lightning", type: "lightning", available: true },
    });
  });

  test("allows missing paymentOptions", () => {
    const payRequest = parsePayRequestResponse(basePayRequest);
    expect(payRequest.paymentOptions).toBeUndefined();
  });

  test("parses option-specific amount bounds", () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      paymentOptions: [{ id: "onchain", type: "onchain", minSendable: 5000, maxSendable: 50_000 }],
    });

    const option = payRequest.paymentOptions?.[0];
    expect(option?.minSendableMsat).toBe(5000n);
    expect(option?.maxSendableMsat).toBe(50000n);
  });

  test("rejects duplicate ids", () => {
    expect(() =>
      parsePayRequestResponse({
        ...basePayRequest,
        paymentOptions: [
          { id: "same", type: "lightning" },
          { id: "same", type: "onchain" },
        ],
      }),
    ).toThrow(InvalidPaymentOptionError);
  });

  test("rejects missing id or type", () => {
    expect(() =>
      parsePayRequestResponse({
        ...basePayRequest,
        paymentOptions: [{ type: "lightning" }],
      }),
    ).toThrow(InvalidPaymentOptionError);

    expect(() =>
      parsePayRequestResponse({
        ...basePayRequest,
        paymentOptions: [{ id: "lightning" }],
      }),
    ).toThrow(InvalidPaymentOptionError);
  });

  test("rejects invalid minSendable/maxSendable on option", () => {
    expect(() =>
      parsePayRequestResponse({
        ...basePayRequest,
        paymentOptions: [{ id: "onchain", type: "onchain", minSendable: "not-a-number" }],
      }),
    ).toThrow(InvalidPaymentOptionError);
  });

  test("rejects min > max on option", () => {
    expect(() =>
      parsePayRequestResponse({
        ...basePayRequest,
        paymentOptions: [
          { id: "onchain", type: "onchain", minSendable: 100_000, maxSendable: 1000 },
        ],
      }),
    ).toThrow(InvalidPaymentOptionError);
  });
});

describe("validatePaymentOption", () => {
  test("passes when no option is requested", () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      paymentOptions,
    });
    expect(() => validatePaymentOption(payRequest, undefined)).not.toThrow();
  });

  test("passes for valid available option", () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      paymentOptions,
    });
    expect(() => validatePaymentOption(payRequest, "lightning")).not.toThrow();
  });

  test("rejects when pay request has no paymentOptions", () => {
    const payRequest = parsePayRequestResponse(basePayRequest);
    expect(() => validatePaymentOption(payRequest, "lightning")).toThrow(InvalidPaymentOptionError);
  });

  test("rejects unknown option", () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      paymentOptions,
    });
    expect(() => validatePaymentOption(payRequest, "bitcoin-cash")).toThrow(
      InvalidPaymentOptionError,
    );
  });

  test("rejects unavailable option", () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      paymentOptions,
    });
    expect(() => validatePaymentOption(payRequest, "liquid")).toThrow(InvalidPaymentOptionError);
  });
});

describe("requestPayment with paymentOption", () => {
  test("includes paymentOption in callback URL", async () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      paymentOptions,
    });

    let capturedUrl: string | undefined;
    const payment = await requestPayment(payRequest, {
      amountMsat: 10_000,
      paymentOption: "onchain",
      fetch: async (input) => {
        capturedUrl = input.toString();
        return jsonResponse({
          status: "OK",
          paymentOption: "onchain",
          paymentDestination: "bc1q...",
          paymentURI: "bitcoin:bc1q...?amount=0.001",
        });
      },
    });

    expect(capturedUrl).toBe("https://example.com/callback?amount=10000&paymentOption=onchain");
    expect(payment.type).toBe("destination");
    expect(payment.paymentOption).toBe("onchain");
    expect(payment.paymentDestination).toBe("bc1q...");
  });

  test("rejects unavailable option before callback", async () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      paymentOptions,
    });

    await expect(
      requestPayment(payRequest, {
        amountMsat: 10_000,
        paymentOption: "liquid",
        fetch: async () => jsonResponse({ status: "ERROR", reason: "unavailable" }),
      }),
    ).rejects.toThrow(InvalidPaymentOptionError);
  });

  test("callback response with BOLT11 includes paymentOption", async () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      paymentOptions: [{ id: "lightning", type: "lightning", available: true }],
    });

    const payment = await requestPayment(payRequest, {
      amountMsat: 2000,
      paymentOption: "lightning",
      validateBolt11: false,
      fetch: async () => jsonResponse({ pr: "lnbc1...", paymentOption: "lightning" }),
    });

    expect(payment).toMatchObject({ type: "bolt11", paymentOption: "lightning" });
  });

  test("rejects explicitly selected lightning option when callback omits pr", async () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      paymentOptions: [{ id: "lightning", type: "lightning", available: true }],
    });

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        paymentOption: "lightning",
        fetch: async () =>
          jsonResponse({
            status: "OK",
            paymentOption: "lightning",
            paymentDestination: "lnbc1...",
            paymentURI: "lightning:lnbc1...",
          }),
      }),
    ).rejects.toThrow(/pr/i);
  });

  test("accepts URI-only callback responses for non-pr payment options", async () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      paymentOptions: [{ id: "contract", type: "example-contract-call", available: true }],
    });

    const payment = await requestPayment(payRequest, {
      amountMsat: 10_000,
      paymentOption: "contract",
      fetch: async () =>
        jsonResponse({
          status: "OK",
          paymentOption: "contract",
          paymentURI: "examplepay:contract/abc?amount=10000",
          verify: "https://example.com/verify/contract",
        }),
    });

    expect(payment).toEqual({
      type: "destination",
      paymentOption: "contract",
      paymentUri: "examplepay:contract/abc?amount=10000",
      verifyUrl: "https://example.com/verify/contract",
      raw: {
        status: "OK",
        paymentOption: "contract",
        paymentURI: "examplepay:contract/abc?amount=10000",
        verify: "https://example.com/verify/contract",
      },
    });
  });

  test("rejects callback paymentOption that does not match requested option", async () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      paymentOptions: [
        { id: "lightning", type: "lightning", available: true },
        { id: "liquid", type: "liquid", available: true },
      ],
    });

    await expect(
      requestPayment(payRequest, {
        amountMsat: 2000,
        paymentOption: "liquid",
        validateBolt11: false,
        fetch: async () => jsonResponse({ pr: "lnbc1...", paymentOption: "lightning" }),
      }),
    ).rejects.toThrow(/paymentOption/i);
  });
});

describe("verifyPayment with paymentOption", () => {
  test("parses paymentOption and paymentReference from non-BOLT11 verify", async () => {
    const result = await verifyPayment("https://example.com/verify", {
      fetch: async () =>
        jsonResponse({
          status: "OK",
          settled: true,
          paymentOption: "onchain",
          paymentDestination: "bc1q...",
          paymentReference: "abc123txid",
        }),
    });

    expect(result.status).toBe("OK");
    expect(result.settled).toBe(true);
    expect(result.paymentOption).toBe("onchain");
    expect(result.paymentDestination).toBe("bc1q...");
    expect(result.paymentReference).toBe("abc123txid");
  });

  test("parses paymentURI from URI-only non-BOLT11 verify responses", async () => {
    const result = await verifyPayment("https://example.com/verify", {
      fetch: async () =>
        jsonResponse({
          status: "OK",
          settled: false,
          paymentOption: "contract",
          paymentURI: "examplepay:contract/abc?amount=10000",
          paymentReference: null,
        }),
    });

    expect(result.paymentOption).toBe("contract");
    expect(result.paymentUri).toBe("examplepay:contract/abc?amount=10000");
    expect(result.paymentReference).toBeNull();
  });

  test("handles null paymentReference", async () => {
    const result = await verifyPayment("https://example.com/verify", {
      fetch: async () =>
        jsonResponse({
          status: "OK",
          settled: false,
          paymentOption: "liquid",
          paymentDestination: "lq1...",
          paymentReference: null,
        }),
    });

    expect(result.paymentReference).toBeNull();
  });

  test("leaves paymentOption undefined when absent", async () => {
    const result = await verifyPayment("https://example.com/verify", {
      fetch: async () =>
        jsonResponse({
          status: "OK",
          settled: true,
          preimage: "00".repeat(32),
          pr: "lnbc10...",
        }),
    });

    expect(result.paymentOption).toBeUndefined();
  });
});
