import type {
  ConvertedAmount,
  DenominatedAmount,
  PaymentInstruction,
  RequestPaymentOptions,
} from "../../src";
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

  const payment = await pay(payRequest.sourceUrl ?? "alice@example.com", {
    amountMsat: 1000n,
  });

  await narrowsDiscriminatedUnion(payment);
  const verifyResult = await verifyPayment(payment.verifyUrl ?? "https://example.com/verify");
  verifyResult.status satisfies "OK" | "ERROR";
}

async function lud22RequestTypesAreUsable() {
  const denominatedAmount: DenominatedAmount = { amount: 100n, currency: "USD" };
  const denominatedOptions: RequestPaymentOptions = {
    denominatedAmount,
    convert: "USD",
  };
  const millisatoshiOptions: RequestPaymentOptions = {
    amountMsat: 1000n,
    convert: "USD",
  };

  const denominatedPayment = await pay("alice@example.com", denominatedOptions);
  const millisatoshiPayment = await pay("alice@example.com", millisatoshiOptions);

  denominatedPayment.converted satisfies ConvertedAmount | undefined;
  millisatoshiPayment.converted satisfies ConvertedAmount | undefined;
}

void exportedTypesAreUsable;
void lud22RequestTypesAreUsable;
