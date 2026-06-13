import { requestPayment, resolve, validateComment } from "../../src";
import { alice, create_mock_lnurl_fetch } from "./mock-provider";

const fetch = create_mock_lnurl_fetch();
const pay_request = await resolve(alice, { fetch });
const comment = "Thanks for the demo";

validateComment(pay_request, comment);

const payment = await requestPayment(pay_request, {
  amountMsat: 25_000,
  comment,
  payerData: { name: "Alice" },
  fetch,
});

console.log(payment.type);
