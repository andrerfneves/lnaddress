import { requestPayment, resolve, validateMandatoryPayerData } from "../../src";
import { alice, createMockLnurlFetch } from "./mock-provider";

const fetch = createMockLnurlFetch();
const payRequest = await resolve(alice, { fetch });
const payerData = {
  name: "Alice",
  email: "alice@example.com",
};

validateMandatoryPayerData(payRequest, payerData);

const payment = await requestPayment(payRequest, {
  amountMsat: 25_000,
  payerData,
  fetch,
});

console.log(payment.type);
