import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { pay, resolve, verifyPayment } from "../../src";
import { start_lnurl_test_server } from "../fixtures/server";

let server: ReturnType<typeof start_lnurl_test_server>;

describe("local LNURL-pay server", () => {
  beforeAll(() => {
    server = start_lnurl_test_server();
  });

  afterAll(() => {
    server.stop();
  });

  test("resolves and requests a BOLT11 payment", async () => {
    const pay_request = await resolve(`${server.origin}/.well-known/lnurlp/alice`);
    expect(pay_request.description).toBe("Alice test payment");

    const payment = await pay(`${server.origin}/.well-known/lnurlp/alice`, {
      amountMsat: 2500,
      comment: "hello",
    });

    expect(payment.type).toBe("bolt11");
    const verified = await verifyPayment(payment);
    expect(verified.settled).toBe(true);
  });

  test("requests and verifies a Liquid-style destination", async () => {
    const payment = await pay(`${server.origin}/.well-known/lnurlp/liquid`, {
      amountMsat: 2500,
    });

    expect(payment).toMatchObject({
      type: "destination",
      paymentDestination: "liquid-address",
    });

    const first = await verifyPayment(payment);
    const second = await verifyPayment(payment);

    expect(first).toMatchObject({ settled: false, paymentReference: null });
    expect(second).toMatchObject({ settled: true, paymentReference: "liquid-txid" });
  });

  test("requests and verifies a BOLT12-style destination", async () => {
    const payment = await pay(`${server.origin}/.well-known/lnurlp/bolt12`, {
      amountMsat: 2500,
    });

    expect(payment).toMatchObject({
      type: "destination",
      paymentDestination: "lno1pg257enxv4ezqcneypekxarpw3jxj",
    });

    const first = await verifyPayment(payment);
    const second = await verifyPayment(payment);

    expect(first).toMatchObject({ settled: false, paymentReference: null });
    expect(second).toMatchObject({
      settled: true,
      paymentReference: "bolt12-payment-hash",
    });
  });
});
