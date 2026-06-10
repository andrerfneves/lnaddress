import { describe, expect, test } from "bun:test";
import { InvalidLnurlError, InvalidPayRequestError, encode_lnurl, resolve } from "../../src";

function json_response(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const pay_request_response = {
  tag: "payRequest",
  callback: "https://example.com/callback",
  minSendable: 1000,
  maxSendable: 10_000,
  metadata: '[["text/plain","Test payment"],["image/png","abc123"]]',
  commentAllowed: 16,
  payerData: {
    name: { mandatory: true },
  },
  currencies: [{ code: "USD" }],
};

describe("resolve", () => {
  test("resolves Lightning Address through the well-known path", async () => {
    const seen_urls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      seen_urls.push(String(input));
      return json_response(pay_request_response);
    };

    const pay_request = await resolve("alice@example.com", { fetch: fetcher });

    expect(seen_urls).toEqual(["https://example.com/.well-known/lnurlp/alice"]);
    expect(pay_request.min_sendable_msat).toBe(1000n);
    expect(pay_request.max_sendable_msat).toBe(10000n);
    expect(pay_request.description).toBe("Test payment");
    expect(pay_request.image?.data_uri).toBe("data:image/png;base64,abc123");
    expect(pay_request.comment_allowed).toBe(16);
    expect(pay_request.payer_data?.name?.mandatory).toBe(true);
    expect(pay_request.currencies).toEqual([{ code: "USD" }]);
    expect(pay_request.raw).toEqual(pay_request_response);
  });

  test("resolves LNURL bech32 input", async () => {
    const url = "https://example.com/lnurlp/alice";
    const fetcher = async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(url);
      return json_response(pay_request_response);
    };

    await expect(resolve(encode_lnurl(url), { fetch: fetcher })).resolves.toMatchObject({
      callback: "https://example.com/callback",
    });
  });

  test("resolves lnurlp:// host/path input", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://example.com/.well-known/lnurlp/alice");
      return json_response(pay_request_response);
    };

    await expect(resolve("lnurlp://example.com/alice", { fetch: fetcher })).resolves.toMatchObject({
      callback: "https://example.com/callback",
    });
  });

  test("rejects non-payRequest responses", async () => {
    const fetcher = async () => json_response({ tag: "withdrawRequest" });

    await expect(resolve("alice@example.com", { fetch: fetcher })).rejects.toThrow(
      InvalidPayRequestError,
    );
  });

  test("allows onion URL, Lightning Address, and lnurlp URI inputs", async () => {
    const seen_urls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      seen_urls.push(String(input));
      return json_response(pay_request_response);
    };

    await resolve("https://abcdefghijklmnop.onion/lnurlp/alice", { fetch: fetcher });
    await resolve("alice@abcdefghijklmnop.onion", { fetch: fetcher });
    await resolve("lnurlp://abcdefghijklmnop.onion/alice", { fetch: fetcher });

    expect(seen_urls).toEqual([
      "https://abcdefghijklmnop.onion/lnurlp/alice",
      "https://abcdefghijklmnop.onion/.well-known/lnurlp/alice",
      "https://abcdefghijklmnop.onion/.well-known/lnurlp/alice",
    ]);
  });
});
