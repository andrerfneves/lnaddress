import type { SuccessAction } from "./types";

function aes_decrypt_not_available(): never {
  throw new Error(
    "AES success_action decryption is not available synchronously. Use the raw ciphertext and Web Crypto in userland.",
  );
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
    return {
      tag,
      description: action.description,
      url: action.url,
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
