import { describe, expect, test } from "bun:test";
import { InvalidPayRequestError, get_metadata_hash, parse_metadata } from "../../src";
import { get_image } from "../../src/metadata";

describe("metadata utilities", () => {
  test("parses metadata tuples", () => {
    expect(
      parse_metadata('[["text/plain","hello"],["text/identifier","alice@example.com"]]'),
    ).toEqual([
      ["text/plain", "hello"],
      ["text/identifier", "alice@example.com"],
    ]);
  });

  test("rejects malformed metadata", () => {
    expect(() => parse_metadata('{"text/plain":"hello"}')).toThrow(InvalidPayRequestError);
    expect(() => parse_metadata("[[1,2]]")).toThrow(InvalidPayRequestError);
    expect(() => parse_metadata('[["text/plain","hello","extra"]]')).toThrow(
      InvalidPayRequestError,
    );
  });

  test("hashes metadata with SHA-256", () => {
    expect(get_metadata_hash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("builds image data URIs without duplicating base64 markers", () => {
    expect(get_image(parse_metadata('[["image/png","abc123"]]'))?.data_uri).toBe(
      "data:image/png;base64,abc123",
    );
    expect(get_image(parse_metadata('[["image/png;base64","abc123"]]'))?.data_uri).toBe(
      "data:image/png;base64,abc123",
    );
  });
});
