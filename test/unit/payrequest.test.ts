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
  test("parses currency extension fields and preserves raw response", () => {
    const raw = {
      ...baseResponse,
      currencies: [{ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 1000 }],
      convert: { USD: 1 },
      converted: { currency: "USD", amount: "0.01" },
    };
    const payRequest = parsePayRequestResponse(raw);

    expect(payRequest.currencies).toMatchObject([
      { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 1000 },
    ]);
    expect(payRequest.raw).toEqual(raw);
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

  test("requires explicit allowOnion for onion callbacks", () => {
    expect(() =>
      parsePayRequestResponse({
        ...baseResponse,
        callback: "https://abcdefghijklmnop.onion/callback",
      }),
    ).toThrow(InvalidPayRequestError);

    expect(
      parsePayRequestResponse(
        {
          ...baseResponse,
          callback: "https://abcdefghijklmnop.onion/callback",
        },
        { allowOnion: true },
      ).callback,
    ).toBe("https://abcdefghijklmnop.onion/callback");
  });

  test("requires explicit allowPrivateNetwork for private callbacks", () => {
    expect(() =>
      parsePayRequestResponse({
        ...baseResponse,
        callback: "http://127.0.0.1/callback",
      }),
    ).toThrow(InvalidPayRequestError);

    expect(
      parsePayRequestResponse(
        {
          ...baseResponse,
          callback: "http://127.0.0.1/callback",
        },
        { allowPrivateNetwork: true },
      ).callback,
    ).toBe("http://127.0.0.1/callback");
  });
});
