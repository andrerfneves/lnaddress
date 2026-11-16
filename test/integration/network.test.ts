import { describe, expect, test } from "bun:test";
import { NetworkError, VerifyError, requestPayment, resolve, verifyPayment } from "../../src";
import type { PaymentInstruction } from "../../src";
import { parsePayRequestResponse } from "../../src/pay/payrequest";
import { testBolt11Invoice, testPaymentHash, testPreimage } from "../fixtures/bolt11";

const payRequestBody = {
  tag: "payRequest",
  callback: "https://example.com/callback",
  minSendable: 1000,
  maxSendable: 100_000,
  metadata: '[["text/plain","Network test"]]',
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function redirect(location: string, status = 302): Response {
  return new Response("redirect body", { status, headers: { location } });
}

/** What browsers return for `redirect: "manual"`: no status, no Location. */
function opaqueRedirect(): Response {
  const response = new Response(null);
  Object.defineProperty(response, "type", { value: "opaqueredirect" });
  Object.defineProperty(response, "status", { value: 0 });
  Object.defineProperty(response, "ok", { value: false });
  return response;
}

function slowBody(text: string, delayMs: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      }, delayMs);
    },
  });
}

describe("redirect handling", () => {
  test("follows redirects manually under the default policy", async () => {
    const seen: string[] = [];
    const payRequest = await resolve("alice@example.com", {
      fetch: async (input, init) => {
        seen.push(String(input));
        expect(init?.redirect).toBe("manual");
        return seen.length === 1
          ? redirect("https://pay.example.net/lnurlp/alice")
          : jsonResponse(payRequestBody);
      },
    });

    expect(payRequest.tag).toBe("payRequest");
    expect(seen).toEqual([
      "https://example.com/.well-known/lnurlp/alice",
      "https://pay.example.net/lnurlp/alice",
    ]);
  });

  test("never requests a private redirect target under the default policy", async () => {
    const seen: string[] = [];
    const attempt = resolve("alice@example.com", {
      fetch: async (input) => {
        seen.push(String(input));
        return redirect("http://169.254.169.254/latest/meta-data");
      },
    });

    const error = await attempt.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(NetworkError);
    expect(((error as NetworkError).cause as Error).message).toMatch(
      /Redirect target is not allowed/,
    );
    expect(seen).toEqual(["https://example.com/.well-known/lnurlp/alice"]);
  });

  test("checks the final URL when a custom fetch follows redirects itself", async () => {
    await expect(
      resolve("alice@example.com", {
        fetch: async () => {
          const response = jsonResponse(payRequestBody);
          Object.defineProperty(response, "redirected", { value: true });
          Object.defineProperty(response, "url", { value: "http://10.0.0.1/lnurlp/alice" });
          return response;
        },
      }),
    ).rejects.toThrow(NetworkError);
  });

  test("allows private redirect targets with allowPrivateNetwork", async () => {
    let calls = 0;
    await expect(
      resolve("alice@example.com", {
        allowPrivateNetwork: true,
        fetch: async () => {
          calls += 1;
          return calls === 1
            ? redirect("http://10.0.0.1/lnurlp/alice")
            : jsonResponse(payRequestBody);
        },
      }),
    ).resolves.toMatchObject({ tag: "payRequest" });
  });

  test("strips credentials on cross-origin hops and keeps them on same-origin hops", async () => {
    const authorization: Array<string | null> = [];
    await resolve("alice@example.com", {
      headers: { authorization: "Bearer secret", "x-client": "wallet" },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        authorization.push(headers.get("authorization"));
        expect(headers.get("x-client")).toBe("wallet");
        const url = String(input);
        if (url.endsWith("/.well-known/lnurlp/alice")) return redirect("/moved");
        if (url === "https://example.com/moved") return redirect("https://pay.example.net/alice");
        return jsonResponse(payRequestBody);
      },
    });

    expect(authorization).toEqual(["Bearer secret", "Bearer secret", null]);
  });

  test("cancels the bodies of intermediate redirect responses", async () => {
    let cancelled = false;
    await resolve("alice@example.com", {
      fetch: async (input) => {
        if (String(input).endsWith("/alice")) {
          const body = new ReadableStream({
            cancel() {
              cancelled = true;
            },
          });
          return new Response(body, {
            status: 302,
            headers: { location: "https://example.com/next" },
          });
        }
        return jsonResponse(payRequestBody);
      },
    });

    expect(cancelled).toBe(true);
  });

  test("rejects redirect loops", async () => {
    await expect(
      resolve("alice@example.com", {
        fetch: async () => redirect("https://example.com/.well-known/lnurlp/alice"),
      }),
    ).rejects.toThrow(NetworkError);
  });

  test("falls back to native redirects for browser opaque redirects and checks the result", async () => {
    const modes: Array<RequestRedirect | undefined> = [];
    const payRequest = await resolve("alice@example.com", {
      fetch: async (_input, init) => {
        modes.push(init?.redirect);
        if (init?.redirect === "manual") return opaqueRedirect();
        const response = jsonResponse(payRequestBody);
        Object.defineProperty(response, "redirected", { value: true });
        Object.defineProperty(response, "url", { value: "https://pay.example.net/alice" });
        return response;
      },
    });

    expect(payRequest.tag).toBe("payRequest");
    expect(modes).toEqual(["manual", "follow"]);

    await expect(
      resolve("alice@example.com", {
        redirectPolicy: "same-origin",
        fetch: async (_input, init) => {
          if (init?.redirect === "manual") return opaqueRedirect();
          const response = jsonResponse(payRequestBody);
          Object.defineProperty(response, "redirected", { value: true });
          Object.defineProperty(response, "url", { value: "https://pay.example.net/alice" });
          return response;
        },
      }),
    ).rejects.toThrow(NetworkError);
  });

  test("rejects browser opaque redirects without refetching under redirectPolicy error", async () => {
    let calls = 0;
    await expect(
      resolve("alice@example.com", {
        redirectPolicy: "error",
        fetch: async () => {
          calls += 1;
          return opaqueRedirect();
        },
      }),
    ).rejects.toThrow(NetworkError);
    expect(calls).toBe(1);
  });
});

describe("timeouts and response size", () => {
  test("timeoutMs covers reading the response body", async () => {
    const started = Date.now();
    await expect(
      resolve("alice@example.com", {
        timeoutMs: 50,
        fetch: async () => new Response(slowBody(JSON.stringify(payRequestBody), 1000)),
      }),
    ).rejects.toThrow(NetworkError);
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("caller signals still cancel body reads when timeoutMs is set", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(
      resolve("alice@example.com", {
        timeoutMs: 10_000,
        signal: controller.signal,
        fetch: async () => new Response(slowBody(JSON.stringify(payRequestBody), 1000)),
      }),
    ).rejects.toThrow(NetworkError);
  });

  test("rejects responses whose content-length exceeds maxResponseBytes", async () => {
    await expect(
      resolve("alice@example.com", {
        maxResponseBytes: 64,
        fetch: async () => jsonResponse(payRequestBody),
      }),
    ).rejects.toThrow(NetworkError);
  });

  test("rejects streamed bodies that grow past maxResponseBytes", async () => {
    const chunk = new TextEncoder().encode(" ".repeat(1024));
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });

    await expect(
      resolve("alice@example.com", { fetch: async () => new Response(endless) }),
    ).rejects.toThrow(NetworkError);
  });

  test("validates maxResponseBytes", async () => {
    await expect(
      resolve("alice@example.com", {
        maxResponseBytes: 0,
        fetch: async () => jsonResponse(payRequestBody),
      }),
    ).rejects.toThrow(NetworkError);
  });
});

describe("verifyPayment invoice checks", () => {
  const payRequest = parsePayRequestResponse(payRequestBody);

  async function bolt11Payment(): Promise<PaymentInstruction> {
    const pr = await testBolt11Invoice(2000, payRequest.metadataHash);
    return requestPayment(payRequest, {
      amountMsat: 2000,
      fetch: async () => jsonResponse({ pr, verify: "https://example.com/verify" }),
    });
  }

  test("marks a preimage that hashes to the invoice payment hash as verified", async () => {
    const payment = await bolt11Payment();
    const result = await verifyPayment(payment, {
      fetch: async () =>
        jsonResponse({
          status: "OK",
          settled: true,
          preimage: testPreimage,
          pr: payment.type === "bolt11" ? payment.pr.toUpperCase() : undefined,
        }),
    });

    expect(testPaymentHash).toHaveLength(64);
    expect(result.preimageVerified).toBe(true);
  });

  test("rejects a preimage that does not match the invoice", async () => {
    const payment = await bolt11Payment();
    await expect(
      verifyPayment(payment, {
        fetch: async () => jsonResponse({ status: "OK", settled: true, preimage: "22".repeat(32) }),
      }),
    ).rejects.toThrow(VerifyError);
  });

  test("rejects a verify response for a different invoice", async () => {
    const payment = await bolt11Payment();
    const other = await testBolt11Invoice(3000, payRequest.metadataHash);
    await expect(
      verifyPayment(payment, {
        fetch: async () =>
          jsonResponse({ status: "OK", settled: false, preimage: null, pr: other }),
      }),
    ).rejects.toThrow(/does not match the requested invoice/);
  });

  test("checks the response pr when verifying by URL", async () => {
    const pr = await testBolt11Invoice(2000, payRequest.metadataHash);
    const ok = await verifyPayment("https://example.com/verify", {
      fetch: async () => jsonResponse({ status: "OK", settled: true, preimage: testPreimage, pr }),
    });
    expect(ok.preimageVerified).toBe(true);

    await expect(
      verifyPayment("https://example.com/verify", {
        fetch: async () =>
          jsonResponse({ status: "OK", settled: true, preimage: "22".repeat(32), pr }),
      }),
    ).rejects.toThrow(VerifyError);
  });

  test("leaves preimageVerified unset when there is no invoice to check", async () => {
    const result = await verifyPayment("https://example.com/verify", {
      fetch: async () => jsonResponse({ status: "OK", settled: true, preimage: testPreimage }),
    });
    expect(result.preimageVerified).toBeUndefined();
  });
});
