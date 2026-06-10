import { describe, expect, test } from "bun:test";
import { VerifyError, verify_payment } from "../../src";

function json_response(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("verify_payment", () => {
  test("parses legacy LUD-21 unpaid and paid responses", async () => {
    await expect(
      verify_payment("https://example.com/verify/unpaid", {
        fetch: async () => json_response({ status: "OK", settled: false, preimage: null }),
      }),
    ).resolves.toMatchObject({
      status: "OK",
      settled: false,
      preimage: null,
    });

    await expect(
      verify_payment("https://example.com/verify/paid", {
        fetch: async () =>
          json_response({
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
      verify_payment(
        {
          type: "destination",
          payment_destination: "liquid-address",
          verify_url: "https://example.com/verify/liquid",
          raw: {},
        },
        {
          fetch: async () =>
            json_response({
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
      payment_destination: "liquid-address",
      payment_reference: "txid",
    });
  });

  test("returns error status responses and rejects invalid shapes", async () => {
    await expect(
      verify_payment("https://example.com/verify/error", {
        fetch: async () => json_response({ status: "ERROR", reason: "unknown payment" }),
      }),
    ).resolves.toMatchObject({
      status: "ERROR",
      reason: "unknown payment",
    });

    await expect(
      verify_payment("https://example.com/verify/bad", {
        fetch: async () => json_response({ settled: true }),
      }),
    ).rejects.toThrow(VerifyError);
  });

  test("requires a verify_url when verifying a payment instruction", async () => {
    await expect(
      verify_payment({
        type: "destination",
        payment_destination: "liquid-address",
        raw: {},
      }),
    ).rejects.toThrow(VerifyError);
  });

  test("rejects onion verify URLs by default and allows them explicitly", async () => {
    await expect(verify_payment("https://abcdefghijklmnop.onion/verify")).rejects.toThrow(
      VerifyError,
    );

    await expect(
      verify_payment("https://abcdefghijklmnop.onion/verify", {
        allow_onion: true,
        fetch: async () => json_response({ status: "OK", settled: false }),
      }),
    ).resolves.toMatchObject({
      status: "OK",
      settled: false,
    });
  });
});
