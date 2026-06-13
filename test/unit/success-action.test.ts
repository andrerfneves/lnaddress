import { describe, expect, test } from "bun:test";
import { InvalidCallbackResponseError, decryptSuccessAction, parseSuccessAction } from "../../src";

function bytes_to_base64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) {
    value += String.fromCharCode(byte);
  }
  return btoa(value);
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("successAction parsing", () => {
  test("validates URL success actions", () => {
    expect(
      parseSuccessAction({
        tag: "url",
        description: "receipt",
        url: "https://example.com/receipt",
      }),
    ).toEqual({
      tag: "url",
      description: "receipt",
      url: "https://example.com/receipt",
    });

    expect(() =>
      parseSuccessAction({
        tag: "url",
        description: "receipt",
        url: "lightning:lnbc1example",
      }),
    ).toThrow(InvalidCallbackResponseError);
  });

  test("decrypts AES success actions with Web Crypto", async () => {
    const preimage = "11".repeat(32);
    const iv = new Uint8Array(16).fill(2);
    const key = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(hexToBytes(preimage)),
      "AES-CBC",
      false,
      ["encrypt"],
    );
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-CBC", iv: toArrayBuffer(iv) },
        key,
        new TextEncoder().encode("paid"),
      ),
    );

    const action = parseSuccessAction({
      tag: "aes",
      description: "secret",
      ciphertext: bytes_to_base64(ciphertext),
      iv: bytes_to_base64(iv),
    });

    expect(action?.tag).toBe("aes");
    if (action?.tag === "aes" && "decrypt" in action) {
      expect(await decryptSuccessAction(action, preimage)).toBe("paid");
      expect(() => action.decrypt(preimage)).toThrow();
    }
  });
});
