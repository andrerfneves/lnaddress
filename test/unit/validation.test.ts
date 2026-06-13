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

const baseResponse = {
  tag: "payRequest",
  callback: "https://example.com/callback",
  minSendable: 1000,
  maxSendable: 5000,
  metadata: '[["text/plain","hello"]]',
};

describe("validation helpers", () => {
  test("accepts amount inside range", () => {
    const payRequest = parsePayRequestResponse(baseResponse);
    expect(() => validateCallbackAmount(payRequest, 1000)).not.toThrow();
    expect(() => validateCallbackAmount(payRequest, 5000n)).not.toThrow();
  });

  test("rejects amount outside range", () => {
    const payRequest = parsePayRequestResponse(baseResponse);
    expect(() => validateCallbackAmount(payRequest, 999)).toThrow(AmountOutOfRangeError);
    expect(() => validateCallbackAmount(payRequest, 5001n)).toThrow(AmountOutOfRangeError);
  });

  test("validates comments against commentAllowed", () => {
    const withoutComment = parsePayRequestResponse(baseResponse);
    expect(() => validateComment(withoutComment, "hi")).toThrow(CommentNotAllowedError);

    const withComment = parsePayRequestResponse({ ...baseResponse, commentAllowed: 2 });
    expect(() => validateComment(withComment, "hi")).not.toThrow();
    expect(() => validateComment(withComment, "hey")).toThrow(CommentTooLongError);
  });

  test("validates mandatory payer data", () => {
    const payRequest = parsePayRequestResponse({
      ...baseResponse,
      payerData: {
        name: { mandatory: true },
        email: { mandatory: false },
      },
    });

    expect(() => validateMandatoryPayerData(payRequest, { name: "Alice" })).not.toThrow();
    expect(() => validateMandatoryPayerData(payRequest, {})).toThrow(
      MissingMandatoryPayerDataError,
    );
    expect(() => validateMandatoryPayerData(payRequest, { name: null })).toThrow(
      MissingMandatoryPayerDataError,
    );
  });
});
