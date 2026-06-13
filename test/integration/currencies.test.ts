import { describe, expect, test } from "bun:test";
import {
  parsePayRequestResponse,
  requestPayment,
  validateCurrency,
} from "../../src";
import { InvalidCallbackResponseError } from "../../src/errors";

describe("LUD-22 currencies parsing", () => {
  test("parses currencies array from payRequest", () => {
    const response = {
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      currencies: [
        {
          code: "USD",
          name: "US Dollar",
          symbol: "$",
          decimals: 2,
          multiplier: 48900,
          convertible: { min: 100, max: 1000000 },
        },
        {
          code: "EUR",
          name: "Euro",
          symbol: "€",
          decimals: 2,
          multiplier: 52000,
        },
      ],
    };

    const payRequest = parsePayRequestResponse(response);
    expect(payRequest.currencies).toBeDefined();
    expect(payRequest.currencies).toHaveLength(2);
    
    const currencies = payRequest.currencies!;
    expect(currencies[0]!.code).toBe("USD");
    expect(currencies[0]!.name).toBe("US Dollar");
    expect(currencies[0]!.symbol).toBe("$");
    expect(currencies[0]!.decimals).toBe(2);
    expect(currencies[0]!.multiplier).toBe(48900);
    expect(currencies[0]!.convertible).toEqual({ min: 100, max: 1000000 });
    expect(currencies[1]!.code).toBe("EUR");
    expect(currencies[1]!.convertible).toBeUndefined();
  });

  test("rejects duplicate currency codes", () => {
    const response = {
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      currencies: [
        { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 48900 },
        { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 49000 },
      ],
    };

    expect(() => parsePayRequestResponse(response)).toThrow(/currencies contains duplicate code/i);
  });

  test("rejects currency with missing required fields", () => {
    const response = {
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      currencies: [
        { code: "USD", name: "US Dollar", symbol: "$" }, // missing decimals and multiplier
      ],
    };

    expect(() => parsePayRequestResponse(response)).toThrow(/currencies entry 0 must have a non-negative integer decimals/i);
  });

  test("rejects currency with negative decimals", () => {
    const response = {
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      currencies: [
        { code: "USD", name: "US Dollar", symbol: "$", decimals: -1, multiplier: 48900 },
      ],
    };

    expect(() => parsePayRequestResponse(response)).toThrow(/currencies entry 0 must have a non-negative integer decimals/i);
  });

  test("rejects currency with non-positive multiplier", () => {
    const response = {
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      currencies: [
        { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 0 },
      ],
    };

    expect(() => parsePayRequestResponse(response)).toThrow(/currencies entry 0 must have a positive multiplier/i);
  });

  test("rejects convertible with min > max", () => {
    const response = {
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      currencies: [
        {
          code: "USD",
          name: "US Dollar",
          symbol: "$",
          decimals: 2,
          multiplier: 48900,
          convertible: { min: 1000, max: 100 },
        },
      ],
    };

    expect(() => parsePayRequestResponse(response)).toThrow(/convertible.*min.*max/i);
  });
});

describe("LUD-22 nested currencies in paymentOptions", () => {
  test("parses currencies nested in paymentOption", () => {
    const response = {
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      paymentOptions: [
        {
          id: "lightning",
          type: "lightning",
          available: true,
          minSendableMsat: 1000,
          maxSendableMsat: 1000000000,
          currencies: [
            { code: "BTC", name: "Bitcoin", symbol: "₿", decimals: 0, multiplier: 1000 },
            { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 48900 },
          ],
        },
        {
          id: "liquid",
          type: "liquid",
          available: true,
          minSendableMsat: 1000,
          maxSendableMsat: 1000000000,
          currencies: [
            { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 48900 },
            { code: "EUR", name: "Euro", symbol: "€", decimals: 2, multiplier: 52000 },
          ],
        },
      ],
    };

    const payRequest = parsePayRequestResponse(response);
    expect(payRequest.paymentOptions).toHaveLength(2);
    
    const lightning = payRequest.paymentOptions![0]!;
    expect(lightning.currencies).toHaveLength(2);
    const lightningCurrencies = lightning.currencies!;
    expect(lightningCurrencies[0]!.code).toBe("BTC");
    expect(lightningCurrencies[1]!.code).toBe("USD");

    const liquid = payRequest.paymentOptions![1]!;
    expect(liquid.currencies).toHaveLength(2);
    const liquidCurrencies = liquid.currencies!;
    expect(liquidCurrencies[0]!.code).toBe("USD");
    expect(liquidCurrencies[1]!.code).toBe("EUR");
  });

  test("paymentOption without currencies inherits from top level", () => {
    const response = {
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      currencies: [
        { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 48900 },
      ],
      paymentOptions: [
        {
          id: "lightning",
          type: "lightning",
          available: true,
          minSendableMsat: 1000,
          maxSendableMsat: 1000000000,
          // No currencies - should inherit from top level
        },
      ],
    };

    const payRequest = parsePayRequestResponse(response);
    expect(payRequest.currencies).toHaveLength(1);
    expect(payRequest.paymentOptions![0]!.currencies).toBeUndefined();
  });
});

describe("LUD-22 currency validation", () => {
  test("validateCurrency passes for valid top-level currency", () => {
    const payRequest = parsePayRequestResponse({
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      currencies: [
        { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 48900 },
      ],
    });

    expect(() => validateCurrency(payRequest, "USD")).not.toThrow();
  });

  test("validateCurrency throws for unknown currency", () => {
    const payRequest = parsePayRequestResponse({
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      currencies: [
        { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 48900 },
      ],
    });

    expect(() => validateCurrency(payRequest, "EUR")).toThrow(InvalidCallbackResponseError);
  });

  test("validateCurrency checks paymentOption-specific currencies", () => {
    const payRequest = parsePayRequestResponse({
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      paymentOptions: [
        {
          id: "lightning",
          type: "lightning",
          available: true,
          minSendableMsat: 1000,
          maxSendableMsat: 1000000000,
          currencies: [
            { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 48900 },
          ],
        },
      ],
    });

    expect(() => validateCurrency(payRequest, "USD", "lightning")).not.toThrow();
    expect(() => validateCurrency(payRequest, "EUR", "lightning")).toThrow(/not available for payment option/i);
  });

  test("validateCurrency falls back to top-level when paymentOption has no currencies", () => {
    const payRequest = parsePayRequestResponse({
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      currencies: [
        { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 48900 },
      ],
      paymentOptions: [
        {
          id: "lightning",
          type: "lightning",
          available: true,
          minSendableMsat: 1000,
          maxSendableMsat: 1000000000,
        },
      ],
    });

    expect(() => validateCurrency(payRequest, "USD", "lightning")).not.toThrow();
  });

  test("validateCurrency passes when no currency specified", () => {
    const payRequest = parsePayRequestResponse({
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
    });

    expect(() => validateCurrency(payRequest)).not.toThrow();
    expect(() => validateCurrency(payRequest, undefined)).not.toThrow();
  });
});

describe("LUD-22 currency in callback URL", () => {
  test("includes currency parameter in callback URL", async () => {
    const payRequest = parsePayRequestResponse({
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      currencies: [
        { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 48900 },
      ],
    });

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      expect(urlStr).toContain("currency=USD");
      expect(urlStr).toContain("amount=100000");
      
      return new Response(
        JSON.stringify({
          pr: "lnbc1...",
          routes: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    await requestPayment(payRequest, {
      amountMsat: 100000,
      currency: "USD",
      validateBolt11: false,
      fetch: mockFetch as any,
    });
  });

  test("includes both paymentOption and currency in callback URL", async () => {
    const payRequest = parsePayRequestResponse({
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      paymentOptions: [
        {
          id: "lightning",
          type: "lightning",
          available: true,
          minSendableMsat: 1000,
          maxSendableMsat: 1000000000,
          currencies: [
            { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 48900 },
          ],
        },
      ],
    });

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      expect(urlStr).toContain("paymentOption=lightning");
      expect(urlStr).toContain("currency=USD");
      
      return new Response(
        JSON.stringify({
          pr: "lnbc1...",
          routes: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    await requestPayment(payRequest, {
      amountMsat: 100000,
      paymentOption: "lightning",
      currency: "USD",
      validateBolt11: false,
      fetch: mockFetch as any,
    });
  });
});

describe("LUD-22 converted amount parsing", () => {
  test("parses converted object from callback response", async () => {
    const payRequest = parsePayRequestResponse({
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      currencies: [
        { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 48900 },
      ],
    });

    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          pr: "lnbc1...",
          routes: [],
          converted: {
            multiplier: 48900,
            amount: 1000, // $10.00
            fee: 50000, // 50,000 msats fee
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const result = await requestPayment(payRequest, {
      amountMsat: 100000,
      currency: "USD",
      validateBolt11: false,
      fetch: mockFetch as any,
    });

    expect(result.type).toBe("bolt11");
    expect(result.converted).toBeDefined();
    expect(result.converted!.multiplier).toBe(48900);
    expect(result.converted!.amount).toBe(1000);
    expect(result.converted!.fee).toBe(50000);
  });

  test("parses converted object from destination payment", async () => {
    const payRequest = parsePayRequestResponse({
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
      paymentOptions: [
        {
          id: "liquid",
          type: "liquid",
          available: true,
          minSendableMsat: 1000,
          maxSendableMsat: 1000000000,
          currencies: [
            { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 48900 },
          ],
        },
      ],
    });

    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          paymentOption: "liquid",
          paymentDestination: "lq1...",
          converted: {
            multiplier: 48900,
            amount: 500,
            fee: 25000,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const result = await requestPayment(payRequest, {
      amountMsat: 100000,
      paymentOption: "liquid",
      currency: "USD",
      fetch: mockFetch as any,
    });

    expect(result.type).toBe("destination");
    expect(result.converted).toBeDefined();
    expect(result.converted!.multiplier).toBe(48900);
    expect(result.converted!.amount).toBe(500);
    expect(result.converted!.fee).toBe(25000);
  });

  test("handles callback response without converted object", async () => {
    const payRequest = parsePayRequestResponse({
      tag: "payRequest",
      callback: "https://example.com/lnurlp/alice/callback",
      minSendable: 1000,
      maxSendable: 1000000000,
      metadata: '[["text/plain","Pay to Alice"]]',
    });

    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          pr: "lnbc1...",
          routes: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const result = await requestPayment(payRequest, {
      amountMsat: 100000,
      validateBolt11: false,
      fetch: mockFetch as any,
    });

    expect(result.type).toBe("bolt11");
    expect(result.converted).toBeUndefined();
  });
});
