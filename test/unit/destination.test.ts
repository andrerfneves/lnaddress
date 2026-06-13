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
  const liquidPayment: PaymentInstruction = {
    type: "destination",
    paymentDestination: "liquid-address",
    paymentUri: "liquidnetwork:liquid-address",
    raw: {},
  };

  const bolt11Payment: PaymentInstruction = {
    type: "bolt11",
    pr: "lnbc1example",
    raw: {},
  };

  test("detects and asserts destination payments", () => {
    expect(isDestinationPayment(liquidPayment)).toBe(true);
    expect(isDestinationPayment(bolt11Payment)).toBe(false);
    expect(assertDestinationPayment(liquidPayment)).toBe(liquidPayment);
    expect(() => assertDestinationPayment(bolt11Payment)).toThrow(InvalidCallbackResponseError);
  });

  test("validates destination rails by payment URI scheme", () => {
    const destination = assertDestinationPayment(liquidPayment);

    expect(destinationMatchesRail(destination, "liquid")).toBe(true);
    expect(destinationMatchesRail(destination, "bitcoin")).toBe(false);
    expect(assertDestinationRail(destination, "liquid")).toBe(destination);
    expect(() => assertDestinationRail(destination, "spark")).toThrow(InvalidCallbackResponseError);
  });
});
