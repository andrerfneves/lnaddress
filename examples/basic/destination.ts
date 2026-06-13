import { pay, verifyPayment } from "../../src";
import { create_mock_lnurl_fetch, liquid } from "./mock-provider";

const fetch = create_mock_lnurl_fetch();
const payment = await pay(liquid, {
  amount_msat: 10_000,
  fetch,
});

if (payment.type !== "destination") {
  throw new Error("Expected a destination instruction");
}

const verified = await verifyPayment(payment, { fetch });

console.log({
  payment_destination: payment.payment_destination,
  payment_uri: payment.payment_uri,
  settled: verified.settled,
});
