import { pay, verifyPayment } from "../../src";
import { alice, create_mock_lnurl_fetch } from "./mock-provider";

const fetch = create_mock_lnurl_fetch();
const payment = await pay(alice, {
  amount_msat: 25_000,
  payer_data: { name: "Alice" },
  fetch,
});

const first = await verifyPayment(payment, { fetch });
const second = await verifyPayment(payment, { fetch });

console.log({
  first_settled: first.settled,
  second_settled: second.settled,
  preimage: second.preimage,
});
