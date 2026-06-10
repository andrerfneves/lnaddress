import { describe, expect, test } from "bun:test";
import { InvalidLnurlError, decode_lnurl, encode_lnurl } from "../../src";

describe("LNURL encode/decode", () => {
  test("round-trips a valid URL", () => {
    const url = "https://example.com/.well-known/lnurlp/alice";
    expect(decode_lnurl(encode_lnurl(url))).toBe(url);
  });

  test("decodes uppercase bech32", () => {
    const url = "https://example.com/lnurlp/alice";
    expect(decode_lnurl(encode_lnurl(url).toUpperCase())).toBe(url);
  });

  test("rejects invalid checksum", () => {
    const encoded = encode_lnurl("https://example.com/alice");
    const invalid = `${encoded.slice(0, -1)}${encoded.endsWith("q") ? "p" : "q"}`;
    expect(() => decode_lnurl(invalid)).toThrow(InvalidLnurlError);
  });

  test("rejects invalid URLs", () => {
    expect(() => encode_lnurl("mailto:alice@example.com")).toThrow(InvalidLnurlError);
  });

  test("allows onion URLs", () => {
    const onion = "https://abcdefghijklmnop.onion/lnurlp/alice";
    expect(decode_lnurl(encode_lnurl(onion))).toBe(onion);
  });
});
