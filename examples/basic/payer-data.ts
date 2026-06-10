import { request_payment, resolve, validate_mandatory_payer_data } from "../../src";
import { alice, create_mock_lnurl_fetch } from "./mock-provider";

const fetch = create_mock_lnurl_fetch();
const pay_request = await resolve(alice, { fetch });
const payer_data = {
  name: "Alice",
  email: "alice@example.com",
};

validate_mandatory_payer_data(pay_request, payer_data);

const payment = await request_payment(pay_request, {
  amount_msat: 25_000,
  payer_data,
  fetch,
});

console.log(payment.type);
