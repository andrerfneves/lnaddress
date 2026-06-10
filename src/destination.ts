import { InvalidCallbackResponseError } from "./errors";
import type { DestinationPaymentInstruction, PaymentInstruction } from "./types";

export type DestinationRail = "lightning" | "bitcoin" | "liquid" | "ark" | "spark";

const rail_schemes: Record<DestinationRail, string[]> = {
  lightning: ["lightning:"],
  bitcoin: ["bitcoin:"],
  liquid: ["liquidnetwork:", "liquid:"],
  ark: ["ark:"],
  spark: ["spark:"],
};

export function is_destination_payment(
  payment: PaymentInstruction,
): payment is DestinationPaymentInstruction {
  return payment.type === "destination";
}

export function assert_destination_payment(
  payment: PaymentInstruction,
): DestinationPaymentInstruction {
  if (!is_destination_payment(payment)) {
    throw new InvalidCallbackResponseError("Payment instruction is not a destination payment");
  }

  return payment;
}

export function destination_matches_rail(
  payment: DestinationPaymentInstruction,
  rail: DestinationRail,
): boolean {
  if (!payment.payment_destination) {
    return false;
  }

  const schemes = rail_schemes[rail];
  if (!payment.payment_uri) {
    return false;
  }

  return schemes.some((scheme) => payment.payment_uri?.toLowerCase().startsWith(scheme));
}

export function assert_destination_rail(
  payment: DestinationPaymentInstruction,
  rail: DestinationRail,
): DestinationPaymentInstruction {
  if (!destination_matches_rail(payment, rail)) {
    throw new InvalidCallbackResponseError(`Destination payment is not a ${rail} payment`);
  }

  return payment;
}
