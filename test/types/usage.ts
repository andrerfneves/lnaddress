import type { PaymentInstruction } from "../../src";
import { pay, resolve, verifyPayment } from "../../src";

async function narrows_discriminated_union(payment: PaymentInstruction) {
  if (payment.type === "bolt11") {
    payment.pr satisfies string;
  } else {
    payment.payment_destination satisfies string;
  }
}

async function exported_types_are_usable() {
  const pay_request = await resolve("alice@example.com");
  pay_request.min_sendable_msat satisfies bigint;
  pay_request.metadata_hash satisfies string;

  const payment = await pay(pay_request.source_url ?? "alice@example.com", {
    amount_msat: 1000n,
  });

  await narrows_discriminated_union(payment);
  const verify_result = await verifyPayment(payment.verify_url ?? "https://example.com/verify");
  verify_result.status satisfies "OK" | "ERROR";
}

void exported_types_are_usable;
