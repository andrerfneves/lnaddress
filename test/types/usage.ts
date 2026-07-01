import type { PaymentInstruction, RequestPaymentOptions } from "../../src";
import { pay, resolve, verifyPayment } from "../../src";

async function narrowsDiscriminatedUnion(payment: PaymentInstruction) {
  if (payment.type === "bolt11") {
    payment.pr satisfies string;
  } else {
    payment.paymentDestination satisfies string | undefined;
    payment.paymentUri satisfies string | undefined;
  }
}

async function exportedTypesAreUsable() {
  const payRequest = await resolve("alice@example.com");
  payRequest.minSendableMsat satisfies bigint;
  payRequest.metadataHash satisfies string;

  const options: RequestPaymentOptions = {
    amountMsat: 1000n,
  };
  const payment = await pay(payRequest.sourceUrl ?? "alice@example.com", options);

  await narrowsDiscriminatedUnion(payment);
  const verifyResult = await verifyPayment(payment.verifyUrl ?? "https://example.com/verify");
  verifyResult.status satisfies "OK" | "ERROR";
}

void exportedTypesAreUsable;
