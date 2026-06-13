import { requestPayment, resolve, validateComment } from "../../src";
import { alice, createMockLnurlFetch } from "./mock-provider";

const fetch = createMockLnurlFetch();
const payRequest = await resolve(alice, { fetch });
const comment = "Thanks for the demo";

validateComment(payRequest, comment);

const payment = await requestPayment(payRequest, {
  amountMsat: 25_000,
  comment,
  payerData: { name: "Alice" },
  fetch,
});

console.log(payment.type);
