import type {
  PaymentInstruction,
  PaymentQuote,
  PaymentUnit,
  RequestPaymentOptions,
  UnitAmount,
} from "../../src";
import { pay, resolve, validateUnit, verifyPayment } from "../../src";

async function narrowsDiscriminatedUnion(payment: PaymentInstruction) {
  if (payment.type === "bolt11") {
    payment.pr satisfies string;
    payment.paymentQuote satisfies PaymentQuote | undefined;
  } else {
    payment.paymentDestination satisfies string | undefined;
    payment.paymentUri satisfies string | undefined;
    payment.paymentQuote satisfies PaymentQuote | undefined;
  }
}

async function exportedTypesAreUsable() {
  const payRequest = await resolve("alice@example.com");
  payRequest.minSendableMsat satisfies bigint;
  payRequest.metadataHash satisfies string;
  payRequest.units satisfies PaymentUnit[] | undefined;

  const options: RequestPaymentOptions = {
    amountMsat: 1000n,
  };
  const payment = await pay(payRequest.sourceUrl ?? "alice@example.com", options);

  await narrowsDiscriminatedUnion(payment);
  const verifyResult = await verifyPayment(payment.verifyUrl ?? "https://example.com/verify");
  verifyResult.status satisfies "OK" | "ERROR";
  verifyResult.paymentQuote satisfies PaymentQuote | undefined;
}

async function unitAmountTypesAreUsable() {
  const payRequest = await resolve("alice@example.com");
  const unitAmount: UnitAmount = { amount: 10000n, unit: "USD" };
  const options: RequestPaymentOptions = {
    unitAmount,
    receiveUnit: "USDT",
    paymentOption: "liquid-usdt",
  };

  validateUnit(payRequest, unitAmount.unit, options.paymentOption, { amount: unitAmount.amount });
  const payment = await pay("alice@example.com", options);
  payment.paymentQuote satisfies PaymentQuote | undefined;
}

void exportedTypesAreUsable;
void unitAmountTypesAreUsable;
