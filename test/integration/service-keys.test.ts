import { describe, expect, test } from "bun:test";
import { InvalidServiceKeysError, NetworkError, fetchServiceKeys } from "../../src";

const signingKey = "031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f";

const serviceKeysResponse = {
  domain: "example.com",
  signingKeys: [
    {
      id: "primary",
      algorithm: "secp256k1",
      publicKey: signingKey,
    },
  ],
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function redirectedResponse(body: unknown, url: string): Response {
  const response = jsonResponse(body);
  Object.defineProperty(response, "redirected", { value: true });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("fetchServiceKeys", () => {
  test("fetches the fixed lnurl-service document for a domain", async () => {
    const seenUrls: string[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrls.push(String(input));
      expect(new Headers(init?.headers).get("accept")).toBe("application/json");
      return jsonResponse(serviceKeysResponse);
    };

    const serviceKeys = await fetchServiceKeys("example.com", { fetch: fetcher });

    expect(seenUrls).toEqual(["https://example.com/.well-known/lnurl-service"]);
    expect(serviceKeys.domain).toBe("example.com");
    expect(serviceKeys.sourceUrl).toBe("https://example.com/.well-known/lnurl-service");
    expect(serviceKeys.signingKeys?.[0]?.publicKey).toBe(signingKey);
  });

  test("passes custom headers and AbortSignal to fetch", async () => {
    const controller = new AbortController();
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      expect(new Headers(init?.headers).get("x-test")).toBe("1");
      return jsonResponse(serviceKeysResponse);
    };

    await expect(
      fetchServiceKeys("example.com", {
        fetch: fetcher,
        headers: { "x-test": "1" },
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ domain: "example.com" });
  });

  test("keeps timeout active while reading a stalled response body", async () => {
    const encoder = new TextEncoder();
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"domain":"example.com",'));
          init?.signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        },
      });

      return new Response(body, { headers: { "content-type": "application/json" } });
    };

    const result = await Promise.race([
      fetchServiceKeys("example.com", { fetch: fetcher, timeoutMs: 5 }).then(
        () => "resolved",
        (error: unknown) => error,
      ),
      new Promise<"stalled">((resolve) => setTimeout(() => resolve("stalled"), 100)),
    ]);

    expect(result).toBeInstanceOf(InvalidServiceKeysError);
  });

  test("rejects domain mismatches in fetched documents", async () => {
    const fetcher = async () =>
      jsonResponse({ ...serviceKeysResponse, domain: "attacker.example" });

    await expect(fetchServiceKeys("example.com", { fetch: fetcher })).rejects.toThrow(
      InvalidServiceKeysError,
    );
  });

  test("wraps non-OK and network failures", async () => {
    await expect(
      fetchServiceKeys("example.com", {
        fetch: async () => jsonResponse({ error: "nope" }, { status: 500 }),
      }),
    ).rejects.toThrow(NetworkError);

    await expect(
      fetchServiceKeys("example.com", {
        fetch: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow(NetworkError);
  });

  test("enforces redirect policy", async () => {
    await expect(
      fetchServiceKeys("example.com", {
        redirectPolicy: "same-origin",
        fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
          expect(init?.redirect).toBe("manual");
          return redirectedResponse(
            serviceKeysResponse,
            "https://keys.example.net/.well-known/lnurl-service",
          );
        },
      }),
    ).rejects.toThrow(NetworkError);
  });
});
