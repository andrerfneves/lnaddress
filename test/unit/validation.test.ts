import { describe, expect, test } from "bun:test";
import {
  AmountOutOfRangeError,
  CommentNotAllowedError,
  CommentTooLongError,
  MissingMandatoryPayerDataError,
  parsePayRequestResponse,
  validateCallbackAmount,
  validateComment,
  validateMandatoryPayerData,
} from "../../src";

const base_response = {
  tag: "payRequest",
  callback: "https://example.com/callback",
  minSendable: 1000,
  maxSendable: 5000,
  metadata: '[["text/plain","hello"]]',
};

describe("validation helpers", () => {
  test("accepts amount inside range", () => {
    const pay_request = parsePayRequestResponse(base_response);
    expect(() => validateCallbackAmount(pay_request, 1000)).not.toThrow();
    expect(() => validateCallbackAmount(pay_request, 5000n)).not.toThrow();
  });

  test("rejects amount outside range", () => {
    const pay_request = parsePayRequestResponse(base_response);
    expect(() => validateCallbackAmount(pay_request, 999)).toThrow(AmountOutOfRangeError);
    expect(() => validateCallbackAmount(pay_request, 5001n)).toThrow(AmountOutOfRangeError);
  });

  test("validates comments against commentAllowed", () => {
    const without_comment = parsePayRequestResponse(base_response);
    expect(() => validateComment(without_comment, "hi")).toThrow(CommentNotAllowedError);

    const with_comment = parsePayRequestResponse({ ...base_response, commentAllowed: 2 });
    expect(() => validateComment(with_comment, "hi")).not.toThrow();
    expect(() => validateComment(with_comment, "hey")).toThrow(CommentTooLongError);
  });

  test("validates mandatory payer data", () => {
    const pay_request = parsePayRequestResponse({
      ...base_response,
      payerData: {
        name: { mandatory: true },
        email: { mandatory: false },
      },
    });

    expect(() => validateMandatoryPayerData(pay_request, { name: "Alice" })).not.toThrow();
    expect(() => validateMandatoryPayerData(pay_request, {})).toThrow(
      MissingMandatoryPayerDataError,
    );
    expect(() => validateMandatoryPayerData(pay_request, { name: null })).toThrow(
      MissingMandatoryPayerDataError,
    );
  });
});
