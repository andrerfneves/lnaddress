import { InvalidCallbackResponseError } from "./errors";
import type { SuccessAction } from "./types";

function aesDecryptNotAvailable(): never {
  throw new Error(
    "AES successAction decryption is not available synchronously. Use the raw ciphertext and Web Crypto in userland.",
  );
}

function base64ToBytes(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new InvalidCallbackResponseError("AES successAction preimage must be 32-byte hex");
  }

  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function parseSuccessAction(raw: unknown): SuccessAction | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const action = raw as Record<string, unknown>;
  const tag = action.tag;

  if (typeof tag !== "string") {
    return undefined;
  }

  if (tag === "message" && typeof action.message === "string") {
    return {
      tag,
      message: action.message,
    };
  }

  if (tag === "url" && typeof action.description === "string" && typeof action.url === "string") {
    let url: URL;
    try {
      url = new URL(action.url);
    } catch (cause) {
      throw new InvalidCallbackResponseError("URL successAction URL is invalid", { cause });
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new InvalidCallbackResponseError("URL successAction URL must use http or https");
    }

    return {
      tag,
      description: action.description,
      url: url.toString(),
    };
  }

  if (
    tag === "aes" &&
    typeof action.description === "string" &&
    typeof action.ciphertext === "string" &&
    typeof action.iv === "string"
  ) {
    return {
      tag,
      description: action.description,
      ciphertext: action.ciphertext,
      iv: action.iv,
      decrypt: aesDecryptNotAvailable,
    };
  }

  return {
    tag,
    raw,
  };
}

export async function decryptSuccessAction(
  action: SuccessAction,
  preimage: string,
): Promise<string> {
  if (action.tag !== "aes" || !("ciphertext" in action) || !("iv" in action)) {
    throw new InvalidCallbackResponseError("successAction must be an AES action");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(hexToBytes(preimage)),
    "AES-CBC",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: toArrayBuffer(base64ToBytes(action.iv)) },
    key,
    toArrayBuffer(base64ToBytes(action.ciphertext)),
  );

  return new TextDecoder().decode(plaintext);
}
