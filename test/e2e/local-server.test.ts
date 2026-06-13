import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { pay, resolve, verifyPayment } from "../../src";
import { startLnurlTestServer } from "../fixtures/server";

let server: ReturnType<typeof startLnurlTestServer>;

describe("local LNURL-pay server", () => {
  beforeAll(() => {
    server = startLnurlTestServer();
  });

  afterAll(() => {
    server.stop();
  });

  test("resolves and requests a BOLT11 payment", async () => {
    const payRequest = await resolve(`${server.origin}/.well-known/lnurlp/alice`, {
      allowPrivateNetwork: true,
    });
    expect(payRequest.description).toBe("Alice test payment");

    const payment = await pay(`${server.origin}/.well-known/lnurlp/alice`, {
      amountMsat: 2500,
      comment: "hello",
      allowPrivateNetwork: true,
    });

    expect(payment.type).toBe("bolt11");
    const verified = await verifyPayment(payment, { allowPrivateNetwork: true });
    expect(verified.settled).toBe(true);
  });

  test("requests and verifies a Liquid-style destination", async () => {
    const payment = await pay(`${server.origin}/.well-known/lnurlp/liquid`, {
      amountMsat: 2500,
      allowPrivateNetwork: true,
    });

    expect(payment).toMatchObject({
      type: "destination",
      paymentDestination: "liquid-address",
    });

    const first = await verifyPayment(payment, { allowPrivateNetwork: true });
    const second = await verifyPayment(payment, { allowPrivateNetwork: true });

    expect(first).toMatchObject({ settled: false, paymentReference: null });
    expect(second).toMatchObject({ settled: true, paymentReference: "liquid-txid" });
  });

  test("requests and verifies a BOLT12-style destination", async () => {
    const payment = await pay(`${server.origin}/.well-known/lnurlp/bolt12`, {
      amountMsat: 2500,
      allowPrivateNetwork: true,
    });

    expect(payment).toMatchObject({
      type: "destination",
      paymentDestination: "lno1pg257enxv4ezqcneypekxarpw3jxj",
    });

    const first = await verifyPayment(payment, { allowPrivateNetwork: true });
    const second = await verifyPayment(payment, { allowPrivateNetwork: true });

    expect(first).toMatchObject({ settled: false, paymentReference: null });
    expect(second).toMatchObject({
      settled: true,
      paymentReference: "bolt12-payment-hash",
    });
  });
});
