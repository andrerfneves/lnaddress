import type { PaymentInstruction } from "../../src";
import { pay, resolve, verifyPayment } from "../../src";

async function narrows_discriminated_union(payment: PaymentInstruction) {
  if (payment.type === "bolt11") {
    payment.pr satisfies string;
  } else {
    payment.paymentDestination satisfies string;
  }
}

async function exported_types_are_usable() {
  const pay_request = await resolve("alice@example.com");
  pay_request.minSendableMsat satisfies bigint;
  pay_request.metadataHash satisfies string;

  const payment = await pay(pay_request.sourceUrl ?? "alice@example.com", {
    amountMsat: 1000n,
  });

  await narrows_discriminated_union(payment);
  const verify_result = await verifyPayment(payment.verifyUrl ?? "https://example.com/verify");
  verify_result.status satisfies "OK" | "ERROR";
}

void exported_types_are_usable;
