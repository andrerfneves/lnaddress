import { describe, expect, test } from "bun:test";
import { InvalidLnurlError, decodeLnurl, encodeLnurl } from "../../src";

const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;

  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;

    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) {
        chk ^= generator[i] ?? 0;
      }
    }
  }

  return chk;
}

function hrp_expand(hrp: string): number[] {
  const expanded: number[] = [];

  for (let i = 0; i < hrp.length; i += 1) {
    expanded.push(hrp.charCodeAt(i) >> 5);
  }

  expanded.push(0);

  for (let i = 0; i < hrp.length; i += 1) {
    expanded.push(hrp.charCodeAt(i) & 31);
  }

  return expanded;
}

function bech32_with_payload(hrp: string, payload: number[]): string {
  const values = [...hrp_expand(hrp), ...payload, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  const checksum: number[] = [];

  for (let p = 0; p < 6; p += 1) {
    checksum.push((mod >> (5 * (5 - p))) & 31);
  }

  return `${hrp}1${[...payload, ...checksum].map((value) => charset[value]).join("")}`;
}

describe("LNURL encode/decode", () => {
  test("round-trips a valid URL", () => {
    const url = "https://example.com/.well-known/lnurlp/alice";
    expect(decodeLnurl(encodeLnurl(url))).toBe(url);
  });

  test("matches known LNURL vectors", () => {
    expect(encodeLnurl("https://example.com/.well-known/lnurlp/alice")).toBe(
      "lnurl1dp68gurn8ghj7etcv9khqmr99e3k7mf09emk2mrv944kummhdchkcmn4wfk8qtmpd35kxeg9saevq",
    );
    expect(
      decodeLnurl("lnurl1dp68gurn8ghj7um9wfmxjcm99e5k7telwy7ksetvd3hj2v3swahhymry5mqgjz"),
    ).toBe("https://service.io/?q=hello%20world");
  });

  test("decodes uppercase bech32", () => {
    const url = "https://example.com/lnurlp/alice";
    expect(decodeLnurl(encodeLnurl(url).toUpperCase())).toBe(url);
  });

  test("rejects invalid checksum", () => {
    const encoded = encodeLnurl("https://example.com/alice");
    const invalid = `${encoded.slice(0, -1)}${encoded.endsWith("q") ? "p" : "q"}`;
    expect(() => decodeLnurl(invalid)).toThrow(InvalidLnurlError);
  });

  test("rejects malformed bech32 inputs", () => {
    const encoded = encodeLnurl("https://example.com/alice");
    const mixed_case = `${encoded.slice(0, 6).toUpperCase()}${encoded.slice(6)}`;

    expect(() => decodeLnurl(mixed_case)).toThrow(InvalidLnurlError);
    expect(() => decodeLnurl("lnurx1qqqqqq")).toThrow(InvalidLnurlError);
    expect(() => decodeLnurl("lnurl1")).toThrow(InvalidLnurlError);
    expect(() => decodeLnurl(bech32_with_payload("lnurl", [1]))).toThrow(InvalidLnurlError);
  });

  test("rejects invalid URLs", () => {
    expect(() => encodeLnurl("mailto:alice@example.com")).toThrow(InvalidLnurlError);
  });

  test("allows onion URLs", () => {
    const onion = "https://abcdefghijklmnop.onion/lnurlp/alice";
    expect(decodeLnurl(encodeLnurl(onion))).toBe(onion);
  });
});
