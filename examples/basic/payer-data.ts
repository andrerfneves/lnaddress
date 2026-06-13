import { requestPayment, resolve, validateMandatoryPayerData } from "../../src";
import { alice, create_mock_lnurl_fetch } from "./mock-provider";

const fetch = create_mock_lnurl_fetch();
const pay_request = await resolve(alice, { fetch });
const payer_data = {
  name: "Alice",
  email: "alice@example.com",
};

validateMandatoryPayerData(pay_request, payer_data);

const payment = await requestPayment(pay_request, {
  amount_msat: 25_000,
  payer_data,
  fetch,
});

console.log(payment.type);
