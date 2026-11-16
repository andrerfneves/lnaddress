import { InvalidLnurlError } from "../core/errors";
import type { UrlSafetyOptions } from "../core/types";
import { Bech32Error, convertBits, decodeBech32, encodeBech32 } from "../utils/bech32";
import { assertHttpUrl } from "../utils/internal";

function asLnurlError(cause: unknown): unknown {
  return cause instanceof Bech32Error ? new InvalidLnurlError(cause.message, { cause }) : cause;
}

export function encodeLnurl(url: string, options: UrlSafetyOptions = {}): string {
  let parsed: URL;

  try {
    parsed = assertHttpUrl(url, options);
  } catch (cause) {
    throw new InvalidLnurlError("LNURL can only encode valid http or https URLs", { cause });
  }

  const bytes = new TextEncoder().encode(parsed.toString());
  return encodeBech32("lnurl", convertBits(bytes, 8, 5, true, "LNURL data"));
}

export function decodeLnurl(lnurl: string, options: UrlSafetyOptions = {}): string {
  let url: string;

  try {
    const { hrp, words } = decodeBech32(lnurl, "LNURL bech32");
    if (hrp !== "lnurl") {
      throw new InvalidLnurlError("LNURL bech32 human-readable part must be lnurl");
    }
    const bytes = convertBits(words, 5, 8, false, "LNURL data");
    url = new TextDecoder().decode(new Uint8Array(bytes));
  } catch (cause) {
    throw asLnurlError(cause);
  }

  try {
    return assertHttpUrl(url, options).toString();
  } catch (cause) {
    throw new InvalidLnurlError("Decoded LNURL does not contain a valid http or https URL", {
      cause,
    });
  }
}
