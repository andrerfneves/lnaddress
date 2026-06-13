import { pay } from "../../src";
import { alice, create_mock_lnurl_fetch } from "./mock-provider";

const fetch = create_mock_lnurl_fetch();
const payment = await pay(alice, {
  amountMsat: 25_000,
  payerData: { name: "Alice" },
  fetch,
});

if (payment.type !== "bolt11") {
  throw new Error("Expected a BOLT11 invoice");
}

console.log(payment.pr);
