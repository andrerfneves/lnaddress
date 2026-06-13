import { describe, expect, test } from "bun:test";
import {
  InvalidLightningAddressError,
  InvalidPayRequestError,
  decodeLnurl,
  encodeLnurl,
  parseLightningAddress,
  parseMetadata,
} from "../../src";

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function pick(random: () => number, alphabet: string): string {
  return alphabet[Math.floor(random() * alphabet.length)] ?? "";
}

function random_string(random: () => number, alphabet: string, max_length: number): string {
  const length = Math.floor(random() * max_length);
  let value = "";

  for (let i = 0; i < length; i += 1) {
    value += pick(random, alphabet);
  }

  return value;
}

describe("deterministic fuzz coverage", () => {
  test("Lightning Address parser accepts valid output or throws library errors", () => {
    const random = lcg(0xadd4e55);
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._~+-@:/[] ";

    for (let i = 0; i < 500; i += 1) {
      const input = random_string(random, alphabet, 80);

      try {
        const parsed = parseLightningAddress(input);
        expect(parsed.address).toBe(`${parsed.username}@${parsed.domain}`);
        expect(parsed.domain).toBe(parsed.domain.toLowerCase());
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidLightningAddressError);
      }
    }
  });

  test("LNURL encode and decode round-trip generated HTTP URLs", () => {
    const random = lcg(0x1066);
    const path_alphabet = "abcdefghijklmnopqrstuvwxyz0123456789-._~";

    for (let i = 0; i < 200; i += 1) {
      const label = random_string(random, "abcdefghijklmnopqrstuvwxyz0123456789", 20) || "a";
      const path = random_string(random, path_alphabet, 40);
      const url = `https://${label}.example/.well-known/lnurlp/${path || "alice"}`;

      expect(decodeLnurl(encodeLnurl(url))).toBe(url);
    }
  });

  test("metadata parser returns tuples or throws library errors", () => {
    const random = lcg(0xfeed);
    const values = [
      null,
      true,
      1,
      "text/plain",
      ["text/plain"],
      ["text/plain", "hello"],
      ["text/plain", "hello", "extra"],
      { mime: "text/plain", value: "hello" },
    ];

    for (let i = 0; i < 200; i += 1) {
      const entries = Array.from({ length: Math.floor(random() * 5) }, () => {
        return values[Math.floor(random() * values.length)];
      });

      try {
        const parsed = parseMetadata(JSON.stringify(entries));
        expect(
          parsed.every(
            ([mime_type, value]) => typeof mime_type === "string" && typeof value === "string",
          ),
        ).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidPayRequestError);
      }
    }
  });
});
