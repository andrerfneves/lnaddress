import { pay, verifyPayment } from "../../src";
import { createMockLnurlFetch, liquid } from "./mock-provider";

const fetch = createMockLnurlFetch();
const payment = await pay(liquid, {
  amountMsat: 10_000,
  fetch,
});

if (payment.type !== "destination") {
  throw new Error("Expected a destination instruction");
}

const verified = await verifyPayment(payment, { fetch });

console.log({
  paymentDestination: payment.paymentDestination,
  paymentUri: payment.paymentUri,
  settled: verified.settled,
});
