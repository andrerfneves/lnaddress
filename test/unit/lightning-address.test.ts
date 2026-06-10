import { describe, expect, test } from "bun:test";
import {
  InvalidLightningAddressError,
  is_lightning_address,
  parse_lightning_address,
} from "../../src";

describe("Lightning Address parsing", () => {
  test("parses valid addresses", () => {
    expect(parse_lightning_address("alice@example.com")).toEqual({
      username: "alice",
      domain: "example.com",
      address: "alice@example.com",
    });
  });

  test("allows plus tags and lowercases the domain", () => {
    expect(parse_lightning_address("alice+wallet@EXAMPLE.COM")).toEqual({
      username: "alice+wallet",
      domain: "example.com",
      address: "alice+wallet@example.com",
    });
  });

  test("punycodes unicode domains through URL parsing", () => {
    expect(parse_lightning_address("alice@bücher.example").domain).toBe("xn--bcher-kva.example");
  });

  test.each([
    "alice",
    "@example.com",
    "alice@",
    "ali ce@example.com",
    "alice@example.com/path",
    "alice@example.com:443",
    "alice@foo_bar.com",
    "alice@-example.com",
    "alice@example-.com",
    "alice@example..com",
    "alice@example.com.",
    "alice@127.0.0.1",
    "alice@[::1]",
    "ålice@example.com",
    `alice@${"a".repeat(64)}.com`,
    `alice@${Array.from({ length: 130 }, () => "a").join(".")}.com`,
  ])("rejects invalid address %s", (address) => {
    expect(() => parse_lightning_address(address)).toThrow(InvalidLightningAddressError);
    expect(is_lightning_address(address)).toBe(false);
  });

  test("detects valid addresses", () => {
    expect(is_lightning_address("bob@example.com")).toBe(true);
  });
});
