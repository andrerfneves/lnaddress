import { pay, verifyPayment } from "../../src";
import { alice, createMockLnurlFetch } from "./mock-provider";

const fetch = createMockLnurlFetch();
const payment = await pay(alice, {
  amountMsat: 25_000,
  payerData: { name: "Alice" },
  fetch,
});

const first = await verifyPayment(payment, { fetch });
const second = await verifyPayment(payment, { fetch });

console.log({
  firstSettled: first.settled,
  secondSettled: second.settled,
  preimage: second.preimage,
});
