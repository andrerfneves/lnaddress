import { describe, expect, test } from "bun:test";
import {
  InvalidCallbackResponseError,
  assert_destination_payment,
  assert_destination_rail,
  destination_matches_rail,
  is_destination_payment,
} from "../../src";
import type { PaymentInstruction } from "../../src";

describe("destination payment helpers", () => {
  const liquid_payment: PaymentInstruction = {
    type: "destination",
    payment_destination: "liquid-address",
    payment_uri: "liquidnetwork:liquid-address",
    raw: {},
  };

  const bolt11_payment: PaymentInstruction = {
    type: "bolt11",
    pr: "lnbc1example",
    raw: {},
  };

  test("detects and asserts destination payments", () => {
    expect(is_destination_payment(liquid_payment)).toBe(true);
    expect(is_destination_payment(bolt11_payment)).toBe(false);
    expect(assert_destination_payment(liquid_payment)).toBe(liquid_payment);
    expect(() => assert_destination_payment(bolt11_payment)).toThrow(InvalidCallbackResponseError);
  });

  test("validates destination rails by payment URI scheme", () => {
    const destination = assert_destination_payment(liquid_payment);

    expect(destination_matches_rail(destination, "liquid")).toBe(true);
    expect(destination_matches_rail(destination, "bitcoin")).toBe(false);
    expect(assert_destination_rail(destination, "liquid")).toBe(destination);
    expect(() => assert_destination_rail(destination, "spark")).toThrow(
      InvalidCallbackResponseError,
    );
  });
});
