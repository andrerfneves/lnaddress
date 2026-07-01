import { describe, expect, test } from "bun:test";
import {
  InvalidLnurlError,
  InvalidPayRequestError,
  NetworkError,
  encodeLnurl,
  resolve,
} from "../../src";

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

const payRequestResponse = {
  tag: "payRequest",
  callback: "https://example.com/callback",
  minSendable: 1000,
  maxSendable: 10_000,
  metadata: '[["text/plain","Test payment"],["image/png","abc123"]]',
  commentAllowed: 16,
  payerData: {
    name: { mandatory: true },
  },
  legacyCurrencies: [
    { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, multiplier: 1000 },
  ],
};

describe("resolve", () => {
  test("resolves Lightning Address through the well-known path", async () => {
    const seenUrls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      seenUrls.push(String(input));
      return jsonResponse(payRequestResponse);
    };

    const payRequest = await resolve("alice@example.com", { fetch: fetcher });

    expect(seenUrls).toEqual(["https://example.com/.well-known/lnurlp/alice"]);
    expect(payRequest.minSendableMsat).toBe(1000n);
    expect(payRequest.maxSendableMsat).toBe(10000n);
    expect(payRequest.description).toBe("Test payment");
    expect(payRequest.image?.dataUri).toBe("data:image/png;base64,abc123");
    expect(payRequest.commentAllowed).toBe(16);
    expect(payRequest.payerData?.name?.mandatory).toBe(true);
    expect("legacyCurrencies" in payRequest).toBe(false);
    expect(payRequest.raw).toEqual(payRequestResponse);
  });

  test("resolves LNURL bech32 input", async () => {
    const url = "https://example.com/lnurlp/alice";
    const fetcher = async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(url);
      return jsonResponse(payRequestResponse);
    };

    await expect(resolve(encodeLnurl(url), { fetch: fetcher })).resolves.toMatchObject({
      callback: "https://example.com/callback",
    });
  });

  test("resolves lnurlp:// host/path input", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://example.com/.well-known/lnurlp/alice");
      return jsonResponse(payRequestResponse);
    };

    await expect(resolve("lnurlp://example.com/alice", { fetch: fetcher })).resolves.toMatchObject({
      callback: "https://example.com/callback",
    });
  });

  test("wraps malformed lnurlp URI paths", async () => {
    await expect(resolve("lnurlp://example.com/%E0%A4%A")).rejects.toThrow(InvalidLnurlError);
  });

  test("rejects non-payRequest responses", async () => {
    const fetcher = async () => jsonResponse({ tag: "withdrawRequest" });

    await expect(resolve("alice@example.com", { fetch: fetcher })).rejects.toThrow(
      InvalidPayRequestError,
    );
  });

  test("requires explicit allowOnion for onion URL, Lightning Address, and lnurlp URI inputs", async () => {
    const seenUrls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      seenUrls.push(String(input));
      return jsonResponse(payRequestResponse);
    };

    await expect(
      resolve("https://abcdefghijklmnop.onion/lnurlp/alice", { fetch: fetcher }),
    ).rejects.toThrow(InvalidLnurlError);
    await expect(resolve("alice@abcdefghijklmnop.onion", { fetch: fetcher })).rejects.toThrow(
      InvalidLnurlError,
    );
    await expect(
      resolve("lnurlp://abcdefghijklmnop.onion/alice", { fetch: fetcher }),
    ).rejects.toThrow(InvalidLnurlError);

    await resolve("https://abcdefghijklmnop.onion/lnurlp/alice", {
      allowOnion: true,
      fetch: fetcher,
    });
    await resolve("alice@abcdefghijklmnop.onion", { allowOnion: true, fetch: fetcher });
    await resolve("lnurlp://abcdefghijklmnop.onion/alice", {
      allowOnion: true,
      fetch: fetcher,
    });

    expect(seenUrls).toEqual([
      "https://abcdefghijklmnop.onion/lnurlp/alice",
      "https://abcdefghijklmnop.onion/.well-known/lnurlp/alice",
      "https://abcdefghijklmnop.onion/.well-known/lnurlp/alice",
    ]);
  });

  test("requires explicit allowPrivateNetwork for local and private URL inputs", async () => {
    const fetcher = async () => jsonResponse(payRequestResponse);

    await expect(resolve("http://127.0.0.1/lnurlp/alice", { fetch: fetcher })).rejects.toThrow(
      InvalidLnurlError,
    );
    await expect(resolve("http://localhost/lnurlp/alice", { fetch: fetcher })).rejects.toThrow(
      InvalidLnurlError,
    );
    await expect(resolve("http://10.0.0.5/lnurlp/alice", { fetch: fetcher })).rejects.toThrow(
      InvalidLnurlError,
    );

    await expect(
      resolve("http://127.0.0.1/lnurlp/alice", { allowPrivateNetwork: true, fetch: fetcher }),
    ).resolves.toMatchObject({ callback: "https://example.com/callback" });
  });

  test("passes AbortSignal to fetch", async () => {
    const controller = new AbortController();
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return jsonResponse(payRequestResponse);
    };

    await expect(
      resolve("alice@example.com", { fetch: fetcher, signal: controller.signal }),
    ).resolves.toMatchObject({
      callback: "https://example.com/callback",
    });
  });

  test("aborts resolve requests after timeoutMs", async () => {
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    };

    await expect(resolve("alice@example.com", { fetch: fetcher, timeoutMs: 1 })).rejects.toThrow(
      NetworkError,
    );
  });

  test("enforces redirect policy before following redirects", async () => {
    await expect(
      resolve("https://example.com/lnurlp/alice", {
        redirectPolicy: "same-origin",
        fetch: async (_input, init) => {
          expect(init?.redirect).toBe("manual");
          return redirectedResponse(payRequestResponse, "https://pay.example.net/lnurlp/alice");
        },
      }),
    ).rejects.toThrow(NetworkError);
  });
});
