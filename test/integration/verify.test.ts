import { describe, expect, test } from "bun:test";
import { VerifyError, verifyPayment } from "../../src";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("verifyPayment", () => {
  test("parses legacy LUD-21 unpaid and paid responses", async () => {
    await expect(
      verifyPayment("https://example.com/verify/unpaid", {
        fetch: async () => jsonResponse({ status: "OK", settled: false, preimage: null }),
      }),
    ).resolves.toMatchObject({
      status: "OK",
      settled: false,
      preimage: null,
    });

    await expect(
      verifyPayment("https://example.com/verify/paid", {
        fetch: async () =>
          jsonResponse({
            status: "OK",
            settled: true,
            preimage: "00".repeat(32),
            pr: "lnbc1qqqqqqqqqqqqqq",
          }),
      }),
    ).resolves.toMatchObject({
      status: "OK",
      settled: true,
      pr: "lnbc1qqqqqqqqqqqqqq",
    });
  });

  test("parses generic destination verification fields", async () => {
    await expect(
      verifyPayment(
        {
          type: "destination",
          paymentDestination: "liquid-address",
          verifyUrl: "https://example.com/verify/liquid",
          raw: {},
        },
        {
          fetch: async () =>
            jsonResponse({
              status: "OK",
              settled: true,
              paymentDestination: "liquid-address",
              paymentReference: "txid",
            }),
        },
      ),
    ).resolves.toMatchObject({
      status: "OK",
      settled: true,
      paymentDestination: "liquid-address",
      paymentReference: "txid",
    });
  });

  test("returns error status responses and rejects invalid shapes", async () => {
    await expect(
      verifyPayment("https://example.com/verify/error", {
        fetch: async () => jsonResponse({ status: "ERROR", reason: "unknown payment" }),
      }),
    ).resolves.toMatchObject({
      status: "ERROR",
      reason: "unknown payment",
    });

    await expect(
      verifyPayment("https://example.com/verify/bad", {
        fetch: async () => jsonResponse({ settled: true }),
      }),
    ).rejects.toThrow(VerifyError);
  });

  test("requires a verifyUrl when verifying a payment instruction", async () => {
    await expect(
      verifyPayment({
        type: "destination",
        paymentDestination: "liquid-address",
        raw: {},
      }),
    ).rejects.toThrow(VerifyError);
  });

  test("requires explicit allowOnion for onion verify URLs", async () => {
    await expect(
      verifyPayment("https://abcdefghijklmnop.onion/verify", {
        fetch: async () => jsonResponse({ status: "OK", settled: false }),
      }),
    ).rejects.toThrow(VerifyError);

    await expect(
      verifyPayment("https://abcdefghijklmnop.onion/verify", {
        allowOnion: true,
        fetch: async () => jsonResponse({ status: "OK", settled: false }),
      }),
    ).resolves.toMatchObject({
      status: "OK",
      settled: false,
    });
  });

  test("requires explicit allowPrivateNetwork for private verify URLs", async () => {
    await expect(
      verifyPayment("http://127.0.0.1/verify", {
        fetch: async () => jsonResponse({ status: "OK", settled: false }),
      }),
    ).rejects.toThrow(VerifyError);

    await expect(
      verifyPayment("http://127.0.0.1/verify", {
        allowPrivateNetwork: true,
        fetch: async () => jsonResponse({ status: "OK", settled: false }),
      }),
    ).resolves.toMatchObject({ status: "OK" });
  });
});
