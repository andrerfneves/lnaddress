import { describe, expect, test } from "bun:test";
import { InvalidPayRequestError, parsePayRequestResponse } from "../../src";

const baseResponse = {
  tag: "payRequest",
  callback: "https://example.com/callback",
  minSendable: 1000,
  maxSendable: 5000,
  metadata: '[["text/plain","hello"]]',
};

describe("pay request parsing", () => {
  test("preserves currency conversion extension fields", () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      currencies: [{ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 1000 }],
      convert: { USD: 1 },
      converted: { currency: "USD", amount: "0.01" },
    });

    expect(payRequest.currencies).toMatchObject([{ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 1000 }]);
    expect(payRequest.convert).toEqual({ USD: 1 });
    expect(payRequest.converted).toEqual({ currency: "USD", amount: "0.01" });
  });

  test("rejects min greater than max", () => {
    expect(() =>
      parsePayRequestResponse({
        ...baseResponse,
        minSendable: 5001,
        maxSendable: 5000,
      }),
    ).toThrow(InvalidPayRequestError);
  });

  test("rejects metadata without a text/plain description", () => {
    expect(() =>
      parsePayRequestResponse({
        ...baseResponse,
        metadata: '[["image/png","abc123"]]',
      }),
    ).toThrow(InvalidPayRequestError);
  });

  test("rejects invalid callback protocols", () => {
    expect(() =>
      parsePayRequestResponse({
        ...baseResponse,
        callback: "ftp://example.com/callback",
      }),
    ).toThrow(InvalidPayRequestError);
  });

  test("allows onion callbacks", () => {
    expect(
      parsePayRequestResponse({
        ...baseResponse,
        callback: "https://abcdefghijklmnop.onion/callback",
      }).callback,
    ).toBe("https://abcdefghijklmnop.onion/callback");
  });
});
