import { describe, expect, test } from "bun:test";
import { InvalidPayRequestError, parse_pay_request_response } from "../../src";

const base_response = {
  tag: "payRequest",
  callback: "https://example.com/callback",
  minSendable: 1000,
  maxSendable: 5000,
  metadata: '[["text/plain","hello"]]',
};

describe("pay request parsing", () => {
  test("preserves currency conversion extension fields", () => {
    const pay_request = parse_pay_request_response({
      ...base_response,
      currencies: [{ code: "USD", symbol: "$" }],
      convert: { USD: 1 },
      converted: { currency: "USD", amount: "0.01" },
    });

    expect(pay_request.currencies).toEqual([{ code: "USD", symbol: "$" }]);
    expect(pay_request.convert).toEqual({ USD: 1 });
    expect(pay_request.converted).toEqual({ currency: "USD", amount: "0.01" });
  });

  test("rejects min greater than max", () => {
    expect(() =>
      parse_pay_request_response({
        ...base_response,
        minSendable: 5001,
        maxSendable: 5000,
      }),
    ).toThrow(InvalidPayRequestError);
  });

  test("rejects metadata without a text/plain description", () => {
    expect(() =>
      parse_pay_request_response({
        ...base_response,
        metadata: '[["image/png","abc123"]]',
      }),
    ).toThrow(InvalidPayRequestError);
  });

  test("rejects invalid callback protocols", () => {
    expect(() =>
      parse_pay_request_response({
        ...base_response,
        callback: "ftp://example.com/callback",
      }),
    ).toThrow(InvalidPayRequestError);
  });

  test("allows onion callbacks", () => {
    expect(
      parse_pay_request_response({
        ...base_response,
        callback: "https://abcdefghijklmnop.onion/callback",
      }).callback,
    ).toBe("https://abcdefghijklmnop.onion/callback");
  });
});
