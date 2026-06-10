import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { pay, resolve, verify_payment } from "../../src";
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
      amount_msat: 2500,
      comment: "hello",
    });

    expect(payment.type).toBe("bolt11");
    const verified = await verify_payment(payment);
    expect(verified.settled).toBe(true);
  });

  test("requests and verifies a Liquid-style destination", async () => {
    const payment = await pay(`${server.origin}/.well-known/lnurlp/liquid`, {
      amount_msat: 2500,
    });

    expect(payment).toMatchObject({
      type: "destination",
      payment_destination: "liquid-address",
    });

    const first = await verify_payment(payment);
    const second = await verify_payment(payment);

    expect(first).toMatchObject({ settled: false, payment_reference: null });
    expect(second).toMatchObject({ settled: true, payment_reference: "liquid-txid" });
  });

  test("requests and verifies a BOLT12-style destination", async () => {
    const payment = await pay(`${server.origin}/.well-known/lnurlp/bolt12`, {
      amount_msat: 2500,
    });

    expect(payment).toMatchObject({
      type: "destination",
      payment_destination: "lno1pg257enxv4ezqcneypekxarpw3jxj",
    });

    const first = await verify_payment(payment);
    const second = await verify_payment(payment);

    expect(first).toMatchObject({ settled: false, payment_reference: null });
    expect(second).toMatchObject({
      settled: true,
      payment_reference: "bolt12-payment-hash",
    });
  });
});
