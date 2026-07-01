import { InvalidCallbackResponseError } from "../core/errors";
import type { DestinationPaymentInstruction, PaymentInstruction } from "../core/types";

export type DestinationRail =
  | "lightning"
  | "bolt12"
  | "bitcoin"
  | "onchain"
  | "liquid"
  | "arkade"
  | "spark"
  | "bark";

const railSchemes: Record<DestinationRail, string[]> = {
  lightning: ["lightning:"],
  bolt12: ["lightning:"],
  bitcoin: ["bitcoin:"],
  onchain: ["bitcoin:"],
  liquid: ["liquidnetwork:", "liquid:"],
  arkade: ["arkade:"],
  spark: ["spark:"],
  bark: ["bark:"],
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
  const schemes = railSchemes[rail];
  if (!payment.paymentUri) {
    return false;
  }

  return schemes.some((scheme) => payment.paymentUri?.toLowerCase().startsWith(scheme));
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
