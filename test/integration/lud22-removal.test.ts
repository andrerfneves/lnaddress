import { describe, expect, test } from "bun:test";
import { parsePayRequestResponse, requestPayment } from "../../src";
import { testBolt11Invoice } from "../fixtures/bolt11";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const basePayRequest = {
  tag: "payRequest",
  callback: "https://example.com/callback",
  minSendable: 1000,
  maxSendable: 100_000,
  metadata: '[["text/plain","LUD-22 removal"]]',
};

describe("LUD-22 removal", () => {
  test("does not expose legacy currencies from payRequest responses", () => {
    const payRequest = parsePayRequestResponse({
      ...basePayRequest,
      currencies: [
        {
          code: "USD",
          name: "US Dollar",
          symbol: "$",
          decimals: 2,
          multiplier: 5000,
          convertible: { min: 100, max: 100_000 },
        },
      ],
      paymentOptions: [
        {
          id: "liquid-usdt",
          type: "liquid",
          currencies: [
            {
              code: "USDT",
              name: "Tether USD",
              symbol: "₮",
              decimals: 6,
              multiplier: 1,
            },
          ],
        },
      ],
    });

    expect("currencies" in payRequest).toBe(false);
    expect(payRequest.paymentOptions?.[0] && "currencies" in payRequest.paymentOptions[0]).toBe(
      false,
    );
    expect(payRequest.raw).toMatchObject({ currencies: expect.any(Array) });
  });

  test("ignores legacy convert requests and converted callback objects", async () => {
    const payRequest = parsePayRequestResponse(basePayRequest);
    let capturedUrl: URL | undefined;

    const payment = await requestPayment(payRequest, {
      amountMsat: 2000,
      // Runtime callers may still pass stale properties. They should be ignored
      // instead of reviving the deleted LUD-22 callback shape.
      convert: "USD",
      fetch: async (input: RequestInfo | URL) => {
        capturedUrl = new URL(String(input));
        return jsonResponse({
          pr: await testBolt11Invoice(2000, payRequest.metadataHash),
          converted: { amount: 100, multiplier: 20, fee: 0 },
        });
      },
    } as unknown as Parameters<typeof requestPayment>[1]);

    expect(capturedUrl?.searchParams.get("amount")).toBe("2000");
    expect(capturedUrl?.searchParams.has("convert")).toBe(false);
    expect(payment.type).toBe("bolt11");
    expect("converted" in payment).toBe(false);
  });
});
