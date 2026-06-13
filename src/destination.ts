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

export function isDestinationPayment(
  payment: PaymentInstruction,
): payment is DestinationPaymentInstruction {
  return payment.type === "destination";
}

export function assertDestinationPayment(
  payment: PaymentInstruction,
): DestinationPaymentInstruction {
  if (!isDestinationPayment(payment)) {
    throw new InvalidCallbackResponseError("Payment instruction is not a destination payment");
  }

  return payment;
}

export function destinationMatchesRail(
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

export function assertDestinationRail(
  payment: DestinationPaymentInstruction,
  rail: DestinationRail,
): DestinationPaymentInstruction {
  if (!destinationMatchesRail(payment, rail)) {
    throw new InvalidCallbackResponseError(`Destination payment is not a ${rail} payment`);
  }

  return payment;
}
