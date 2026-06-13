import { describe, expect, test } from "bun:test";
import { parsePayRequestResponse, requestPayment, validateCurrency } from "../../src";
import type { RequestPaymentOptions } from "../../src";
import { AmountOutOfRangeError, InvalidCallbackResponseError } from "../../src/errors";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const usd = {
  code: "USD",
  name: "US Dollar",
  symbol: "$",
  decimals: 2,
  multiplier: 48_900,
  convertible: { min: 100, max: 1_000_000 },
};

const eur = {
  code: "EUR",
  name: "Euro",
  symbol: "€",
  decimals: 2,
  multiplier: 52_000,
};

const brl = {
  code: "BRL",
  name: "Brazilian Real",
  symbol: "R$",
  decimals: 2,
  multiplier: 5_370,
  convertible: { min: 100, max: 1_000_000 },
};

const usdt = {
  code: "USDT",
  name: "Tether",
  symbol: "₮",
  decimals: 6,
  multiplier: 2.68,
  convertible: { min: 1_000, max: 10_000_000_000 },
};

const baseResponse = {
  tag: "payRequest",
  callback: "https://example.com/lnurlp/alice/callback?k1=abc",
  minSendable: 1000,
  maxSendable: 1_000_000_000,
  metadata: '[["text/plain","Pay to Alice"]]',
};

describe("LUD-22 currencies parsing", () => {
  test("parses currencies array from payRequest", () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      currencies: [usd, eur],
    });

    expect(payRequest.currencies).toHaveLength(2);
    const currencies = payRequest.currencies ?? [];
    expect(currencies[0]).toMatchObject(usd);
    expect(currencies[1]).toMatchObject(eur);
    expect(currencies[0]?.raw).toMatchObject(usd);
  });

  test("rejects duplicate currency codes", () => {
    expect(() =>
      parsePayRequestResponse({
        ...baseResponse,
        currencies: [usd, { ...usd, multiplier: 49_000 }],
      }),
    ).toThrow(/currencies contains duplicate code/i);
  });

  test("rejects currency with missing required fields", () => {
    expect(() =>
      parsePayRequestResponse({
        ...baseResponse,
        currencies: [{ code: "USD", name: "US Dollar", symbol: "$" }],
      }),
    ).toThrow(/currencies entry 0 must have a non-negative integer decimals/i);
  });

  test("rejects currency with negative decimals", () => {
    expect(() =>
      parsePayRequestResponse({
        ...baseResponse,
        currencies: [{ ...usd, decimals: -1 }],
      }),
    ).toThrow(/currencies entry 0 must have a non-negative integer decimals/i);
  });

  test("rejects currency with non-positive multiplier", () => {
    expect(() =>
      parsePayRequestResponse({
        ...baseResponse,
        currencies: [{ ...usd, multiplier: 0 }],
      }),
    ).toThrow(/currencies entry 0 must have a positive multiplier/i);
  });

  test("rejects convertible with min > max", () => {
    expect(() =>
      parsePayRequestResponse({
        ...baseResponse,
        currencies: [{ ...usd, convertible: { min: 1000, max: 100 } }],
      }),
    ).toThrow(/convertible.*min.*max/i);
  });
});

describe("LUD-22 nested currencies in paymentOptions", () => {
  test("parses currencies nested in paymentOption", () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      paymentOptions: [
        {
          id: "lightning",
          type: "lightning",
          available: true,
          minSendable: 1000,
          maxSendable: 1_000_000_000,
          currencies: [usd, brl],
        },
        {
          id: "liquid",
          type: "liquid",
          available: true,
          minSendable: 1000,
          maxSendable: 1_000_000_000,
          currencies: [brl, usdt],
        },
      ],
    });

    expect(payRequest.paymentOptions).toHaveLength(2);

    const lightning = payRequest.paymentOptions?.[0];
    expect(lightning?.currencies).toHaveLength(2);
    expect(lightning?.currencies?.[0]).toMatchObject(usd);
    expect(lightning?.currencies?.[1]).toMatchObject(brl);

    const liquid = payRequest.paymentOptions?.[1];
    expect(liquid?.currencies).toHaveLength(2);
    expect(liquid?.currencies?.[0]).toMatchObject(brl);
    expect(liquid?.currencies?.[1]).toMatchObject(usdt);
  });

  test("paymentOption without currencies inherits from top-level currencies", () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      currencies: [usd],
      paymentOptions: [{ id: "lightning", type: "lightning", available: true }],
    });

    expect(payRequest.currencies).toHaveLength(1);
    expect(payRequest.paymentOptions?.[0]?.currencies).toBeUndefined();
    expect(() =>
      validateCurrency(payRequest, "USD", "lightning", { requireConvertible: false }),
    ).not.toThrow();
  });
});

describe("LUD-22 effective currency validation", () => {
  test("passes for valid top-level denomination currency", () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, currencies: [usd] });
    expect(() => validateCurrency(payRequest, "USD")).not.toThrow();
  });

  test("throws for unknown top-level currency", () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, currencies: [usd] });
    expect(() => validateCurrency(payRequest, "EUR")).toThrow(InvalidCallbackResponseError);
  });

  test("checks paymentOption-specific currencies before falling back", () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      currencies: [usd, eur],
      paymentOptions: [
        {
          id: "liquid",
          type: "liquid",
          available: true,
          currencies: [brl, usdt],
        },
      ],
    });

    expect(() => validateCurrency(payRequest, "BRL", "liquid")).not.toThrow();
    expect(() => validateCurrency(payRequest, "USD", "liquid")).toThrow(
      /not available for paymentOption/i,
    );
  });

  test("requires convertible metadata for convert targets", () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, currencies: [usd, eur] });
    expect(() =>
      validateCurrency(payRequest, "USD", undefined, { requireConvertible: true }),
    ).not.toThrow();
    expect(() =>
      validateCurrency(payRequest, "EUR", undefined, { requireConvertible: true }),
    ).toThrow(/not convertible/i);
  });

  test("allows no currency when request uses base millisatoshi amount", () => {
    const payRequest = parsePayRequestResponse(baseResponse);
    expect(() => validateCurrency(payRequest)).not.toThrow();
  });
});

describe("LUD-22 callback parameters", () => {
  test("uses base LUD-06 amount when only amountMsat is provided", async () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, currencies: [brl] });

    await requestPayment(payRequest, {
      amountMsat: 538_000,
      validateBolt11: false,
      fetch: async (input) => {
        const url = new URL(input.toString());
        expect(url.searchParams.get("amount")).toBe("538000");
        expect(url.searchParams.has("convert")).toBe(false);
        expect(url.searchParams.has("currency")).toBe(false);
        return jsonResponse({ pr: "lnbc1...", routes: [] });
      },
    });
  });

  test("uses LUD-22 amount=<units>.<code> for denominated amounts", async () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, currencies: [brl] });

    await requestPayment(payRequest, {
      denominatedAmount: { amount: 100, currency: "BRL" },
      validateBolt11: false,
      fetch: async (input) => {
        const url = new URL(input.toString());
        expect(url.searchParams.get("amount")).toBe("100.BRL");
        expect(url.searchParams.has("currency")).toBe(false);
        expect(url.searchParams.has("convert")).toBe(false);
        return jsonResponse({ pr: "lnbc1...", routes: [] });
      },
    });
  });

  test("uses LUD-22 convert=<code> for receiver-side conversion", async () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, currencies: [brl] });

    await requestPayment(payRequest, {
      amountMsat: 538_000,
      convert: "BRL",
      validateBolt11: false,
      fetch: async (input) => {
        const url = new URL(input.toString());
        expect(url.searchParams.get("amount")).toBe("538000");
        expect(url.searchParams.get("convert")).toBe("BRL");
        expect(url.searchParams.has("currency")).toBe(false);
        return jsonResponse({
          pr: "lnbc1...",
          routes: [],
          converted: { amount: 100, fee: 1000, multiplier: 5370 },
        });
      },
    });
  });

  test("combines paymentOption, denominated amount, and convert without non-spec currency param", async () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      paymentOptions: [
        {
          id: "liquid",
          type: "liquid",
          available: true,
          currencies: [brl, usdt],
        },
      ],
    });

    await requestPayment(payRequest, {
      paymentOption: "liquid",
      denominatedAmount: { amount: 100, currency: "BRL" },
      convert: "USDT",
      validateBolt11: false,
      fetch: async (input) => {
        const url = new URL(input.toString());
        expect(url.searchParams.get("paymentOption")).toBe("liquid");
        expect(url.searchParams.get("amount")).toBe("100.BRL");
        expect(url.searchParams.get("convert")).toBe("USDT");
        expect(url.searchParams.has("currency")).toBe(false);
        return jsonResponse({
          paymentOption: "liquid",
          paymentDestination: "lq1...",
          converted: { amount: 200_000, fee: 2000, multiplier: 2.68 },
        });
      },
    });
  });

  test("rejects requests with both amountMsat and denominatedAmount", async () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, currencies: [brl] });

    await expect(
      requestPayment(payRequest, {
        amountMsat: 538_000,
        denominatedAmount: { amount: 100, currency: "BRL" },
        validateBolt11: false,
        fetch: async () => jsonResponse({ pr: "lnbc1..." }),
      } as unknown as RequestPaymentOptions),
    ).rejects.toThrow(/amountMsat and denominatedAmount are mutually exclusive/i);
  });

  test("rejects denominated amounts that are not positive integers", async () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, currencies: [brl] });

    await expect(
      requestPayment(payRequest, {
        denominatedAmount: { amount: 1.5, currency: "BRL" },
        validateBolt11: false,
        fetch: async () => jsonResponse({ pr: "lnbc1..." }),
      }),
    ).rejects.toThrow(AmountOutOfRangeError);
  });

  test("rejects convert targets that are unavailable on the selected payment option", async () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      currencies: [usd],
      paymentOptions: [{ id: "liquid", type: "liquid", available: true, currencies: [brl] }],
    });

    await expect(
      requestPayment(payRequest, {
        amountMsat: 538_000,
        paymentOption: "liquid",
        convert: "USD",
        validateBolt11: false,
        fetch: async () => jsonResponse({ pr: "lnbc1..." }),
      }),
    ).rejects.toThrow(/not available for paymentOption/i);
  });
});

describe("LUD-22 converted amount parsing", () => {
  test("requires converted object when convert is requested", async () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, currencies: [brl] });

    await expect(
      requestPayment(payRequest, {
        amountMsat: 538_000,
        convert: "BRL",
        validateBolt11: false,
        fetch: async () => jsonResponse({ pr: "lnbc1...", routes: [] }),
      }),
    ).rejects.toThrow(/converted/i);
  });

  test("parses converted object from BOLT11 callback response", async () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, currencies: [brl] });

    const result = await requestPayment(payRequest, {
      amountMsat: 538_000,
      convert: "BRL",
      validateBolt11: false,
      fetch: async () =>
        jsonResponse({
          pr: "lnbc1...",
          routes: [],
          converted: { multiplier: 5370, amount: 100, fee: 1000 },
        }),
    });

    expect(result.type).toBe("bolt11");
    expect(result.converted).toEqual({
      multiplier: 5370,
      amount: 100,
      fee: 1000,
      raw: { multiplier: 5370, amount: 100, fee: 1000 },
    });
  });

  test("parses converted object from destination payment response", async () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      paymentOptions: [{ id: "liquid", type: "liquid", available: true, currencies: [brl] }],
    });

    const result = await requestPayment(payRequest, {
      amountMsat: 538_000,
      paymentOption: "liquid",
      convert: "BRL",
      fetch: async () =>
        jsonResponse({
          paymentOption: "liquid",
          paymentDestination: "lq1...",
          converted: { multiplier: 5370, amount: 100, fee: 1000 },
        }),
    });

    expect(result.type).toBe("destination");
    expect(result.converted).toMatchObject({ multiplier: 5370, amount: 100, fee: 1000 });
  });

  test("rejects malformed converted object instead of silently ignoring it", async () => {
    const payRequest = parsePayRequestResponse({ ...baseResponse, currencies: [brl] });

    await expect(
      requestPayment(payRequest, {
        amountMsat: 538_000,
        convert: "BRL",
        validateBolt11: false,
        fetch: async () =>
          jsonResponse({
            pr: "lnbc1...",
            routes: [],
            converted: { multiplier: 5370, amount: "100", fee: 1000 },
          }),
      }),
    ).rejects.toThrow(/converted.amount/i);
  });

  test("handles callback response without converted object when no conversion was requested", async () => {
    const payRequest = parsePayRequestResponse(baseResponse);

    const result = await requestPayment(payRequest, {
      amountMsat: 100_000,
      validateBolt11: false,
      fetch: async () => jsonResponse({ pr: "lnbc1...", routes: [] }),
    });

    expect(result.type).toBe("bolt11");
    expect(result.converted).toBeUndefined();
  });
});
