import { request_payment, resolve, validate_comment } from "../../src";
import { alice, create_mock_lnurl_fetch } from "./mock-provider";

const fetch = create_mock_lnurl_fetch();
const pay_request = await resolve(alice, { fetch });
const comment = "Thanks for the demo";

validate_comment(pay_request, comment);

const payment = await request_payment(pay_request, {
  amount_msat: 25_000,
  comment,
  payer_data: { name: "Alice" },
  fetch,
});

console.log(payment.type);
