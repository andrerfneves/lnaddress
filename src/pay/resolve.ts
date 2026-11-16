import { parseLightningAddress } from "../address/lightning-address";
import { decodeLnurl } from "../address/lnurl";
import {
  InvalidLightningAddressError,
  InvalidLnurlError,
  InvalidPayRequestError,
} from "../core/errors";
import type { LightningAddress, PayRequest, ResolveOptions } from "../core/types";
import { JsonBodyError, fetchJson } from "../utils/http";
import { assertHttpUrl } from "../utils/internal";
import { parsePayRequestResponse } from "./payrequest";

function lightningAddressToUrl(address: LightningAddress): string {
  return `https://${address.domain}/.well-known/lnurlp/${address.username}`;
}

function assertResolveUrl(url: string, options: ResolveOptions): string {
  try {
    return assertHttpUrl(url, options).toString();
  } catch (cause) {
    throw new InvalidLnurlError("Generated LNURL-pay endpoint URL is invalid", {
      cause,
    });
  }
}

function lnurlpUriToUrl(input: string): {
  url: string;
  lightningAddress?: LightningAddress;
} {
  let parsed: URL;

  try {
    parsed = new URL(input);
  } catch (cause) {
    throw new InvalidLnurlError("lnurlp URI is invalid", { cause });
  }

  if (parsed.protocol !== "lnurlp:") {
    throw new InvalidLnurlError("URI must use the lnurlp scheme");
  }

  if (parsed.username) {
    const lightningAddress = parseLightningAddress(`${parsed.username}@${parsed.hostname}`);
    return {
      url: lightningAddressToUrl(lightningAddress),
      lightningAddress,
    };
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch (cause) {
    throw new InvalidLnurlError("lnurlp URI path is invalid", { cause });
  }

  if (!parsed.hostname || !pathname) {
    throw new InvalidLnurlError("lnurlp URI must include a host and username path");
  }

  if (pathname.startsWith(".well-known/lnurlp/")) {
    return {
      url: `https://${parsed.host}/${pathname}${parsed.search}`,
    };
  }

  return {
    url: `https://${parsed.host}/.well-known/lnurlp/${encodeURIComponent(pathname)}${parsed.search}`,
  };
}

function inputToUrl(
  input: string,
  options: ResolveOptions,
): { url: string; address?: LightningAddress } {
  const value = input.trim();
  const lower = value.toLowerCase();

  if (lower.startsWith("lnurlp://")) {
    const result = lnurlpUriToUrl(value);
    return result.lightningAddress
      ? {
          url: assertResolveUrl(result.url, options),
          address: result.lightningAddress,
        }
      : {
          url: assertResolveUrl(result.url, options),
        };
  }

  if (lower.startsWith("lnurl")) {
    return {
      url: decodeLnurl(value, options),
    };
  }

  if (!value.includes("://") && value.includes("@")) {
    const address = parseLightningAddress(value);
    return {
      url: assertResolveUrl(lightningAddressToUrl(address), options),
      address,
    };
  }

  try {
    const parsed = assertHttpUrl(value, options);
    return {
      url: parsed.toString(),
    };
  } catch (cause) {
    if (value.includes("@")) {
      throw new InvalidLightningAddressError("Lightning Address input is invalid", { cause });
    }
    throw new InvalidLnurlError("Input is not a Lightning Address, LNURL, lnurlp URI, or URL", {
      cause,
    });
  }
}

export async function resolve(input: string, options: ResolveOptions = {}): Promise<PayRequest> {
  const { url, address } = inputToUrl(input, options);
  let raw: unknown;
  try {
    raw = await fetchJson(new URL(url), options, "resolve LNURL-pay endpoint");
  } catch (cause) {
    if (cause instanceof JsonBodyError) {
      throw new InvalidPayRequestError("Resolved response is not valid JSON", { cause });
    }
    throw cause;
  }

  const parseContext = {
    sourceUrl: url,
    ...(options.allowOnion !== undefined ? { allowOnion: options.allowOnion } : {}),
    ...(options.allowPrivateNetwork !== undefined
      ? { allowPrivateNetwork: options.allowPrivateNetwork }
      : {}),
    ...(address ? { lightningAddress: address } : {}),
  };

  return parsePayRequestResponse(raw, parseContext);
}
