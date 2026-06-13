import { requestPayment, resolve, validateMandatoryPayerData } from "../../src";
import { alice, create_mock_lnurl_fetch } from "./mock-provider";

const fetch = create_mock_lnurl_fetch();
const pay_request = await resolve(alice, { fetch });
const payerData = {
  name: "Alice",
  email: "alice@example.com",
};

validateMandatoryPayerData(pay_request, payerData);

const payment = await requestPayment(pay_request, {
  amountMsat: 25_000,
  payerData,
  fetch,
});

console.log(payment.type);
