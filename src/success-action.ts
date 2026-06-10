import { InvalidCallbackResponseError } from "./errors";
import type { SuccessAction } from "./types";

function aes_decrypt_not_available(): never {
  throw new Error(
    "AES success_action decryption is not available synchronously. Use the raw ciphertext and Web Crypto in userland.",
  );
}

function base64_to_bytes(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

function hex_to_bytes(value: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new InvalidCallbackResponseError("AES success_action preimage must be 32-byte hex");
  }

  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function to_array_buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function parse_success_action(raw: unknown): SuccessAction | undefined {
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
      throw new InvalidCallbackResponseError("URL success_action URL is invalid", { cause });
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new InvalidCallbackResponseError("URL success_action URL must use http or https");
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
      decrypt: aes_decrypt_not_available,
    };
  }

  return {
    tag,
    raw,
  };
}

export async function decrypt_success_action(
  action: SuccessAction,
  preimage: string,
): Promise<string> {
  if (action.tag !== "aes" || !("ciphertext" in action) || !("iv" in action)) {
    throw new InvalidCallbackResponseError("success_action must be an AES action");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    to_array_buffer(hex_to_bytes(preimage)),
    "AES-CBC",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: to_array_buffer(base64_to_bytes(action.iv)) },
    key,
    to_array_buffer(base64_to_bytes(action.ciphertext)),
  );

  return new TextDecoder().decode(plaintext);
}
