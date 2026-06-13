import { pay } from "../../src";
import { alice, createMockLnurlFetch } from "./mock-provider";

const fetch = createMockLnurlFetch();
const payment = await pay(alice, {
  amountMsat: 25_000,
  payerData: { name: "Alice" },
  fetch,
});

if (payment.type !== "bolt11") {
  throw new Error("Expected a BOLT11 invoice");
}

console.log(payment.pr);
