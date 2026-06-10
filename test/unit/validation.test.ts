import { describe, expect, test } from "bun:test";
import {
  AmountOutOfRangeError,
  CommentNotAllowedError,
  CommentTooLongError,
  MissingMandatoryPayerDataError,
  parse_pay_request_response,
  validate_callback_amount,
  validate_comment,
  validate_mandatory_payer_data,
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
    const pay_request = parse_pay_request_response(base_response);
    expect(() => validate_callback_amount(pay_request, 1000)).not.toThrow();
    expect(() => validate_callback_amount(pay_request, 5000n)).not.toThrow();
  });

  test("rejects amount outside range", () => {
    const pay_request = parse_pay_request_response(base_response);
    expect(() => validate_callback_amount(pay_request, 999)).toThrow(AmountOutOfRangeError);
    expect(() => validate_callback_amount(pay_request, 5001n)).toThrow(AmountOutOfRangeError);
  });

  test("validates comments against comment_allowed", () => {
    const without_comment = parse_pay_request_response(base_response);
    expect(() => validate_comment(without_comment, "hi")).toThrow(CommentNotAllowedError);

    const with_comment = parse_pay_request_response({ ...base_response, commentAllowed: 2 });
    expect(() => validate_comment(with_comment, "hi")).not.toThrow();
    expect(() => validate_comment(with_comment, "hey")).toThrow(CommentTooLongError);
  });

  test("validates mandatory payer data", () => {
    const pay_request = parse_pay_request_response({
      ...base_response,
      payerData: {
        name: { mandatory: true },
        email: { mandatory: false },
      },
    });

    expect(() => validate_mandatory_payer_data(pay_request, { name: "Alice" })).not.toThrow();
    expect(() => validate_mandatory_payer_data(pay_request, {})).toThrow(
      MissingMandatoryPayerDataError,
    );
    expect(() => validate_mandatory_payer_data(pay_request, { name: null })).toThrow(
      MissingMandatoryPayerDataError,
    );
  });
});
