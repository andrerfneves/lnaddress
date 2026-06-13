import { describe, expect, test } from "bun:test";
import {
  InvalidCallbackResponseError,
  assertDestinationPayment,
  assertDestinationRail,
  destinationMatchesRail,
  isDestinationPayment,
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
    expect(isDestinationPayment(liquid_payment)).toBe(true);
    expect(isDestinationPayment(bolt11_payment)).toBe(false);
    expect(assertDestinationPayment(liquid_payment)).toBe(liquid_payment);
    expect(() => assertDestinationPayment(bolt11_payment)).toThrow(InvalidCallbackResponseError);
  });

  test("validates destination rails by payment URI scheme", () => {
    const destination = assertDestinationPayment(liquid_payment);

    expect(destinationMatchesRail(destination, "liquid")).toBe(true);
    expect(destinationMatchesRail(destination, "bitcoin")).toBe(false);
    expect(assertDestinationRail(destination, "liquid")).toBe(destination);
    expect(() => assertDestinationRail(destination, "spark")).toThrow(InvalidCallbackResponseError);
  });
});
