import {
  InvalidLightningAddressError,
  InvalidLnurlError,
  InvalidPayRequestError,
  NetworkError,
} from "./errors";
import {
  assertHttpUrl,
  assertRedirectPolicy,
  getFetch,
  readJsonResponse,
  requestInit,
} from "./internal";
import { parseLightningAddress } from "./lightning-address";
import { decodeLnurl } from "./lnurl";
import { parsePayRequestResponse } from "./payrequest";
import type { LightningAddress, PayRequest, ResolveOptions } from "./types";

function lightningAddress_to_url(lightningAddress: LightningAddress): string {
  return `https://${lightningAddress.domain}/.well-known/lnurlp/${encodeURIComponent(
    lightningAddress.username,
  )}`;
}

function assert_resolve_url(url: string, options: ResolveOptions): string {
  try {
    return assertHttpUrl(url, options).toString();
  } catch (cause) {
    throw new InvalidLnurlError("Generated LNURL-pay endpoint URL is invalid", { cause });
  }
}

function lnurlp_uri_to_url(input: string): { url: string; lightningAddress?: LightningAddress } {
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
      url: lightningAddress_to_url(lightningAddress),
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
    const result = lnurlp_uri_to_url(value);
    return result.lightningAddress
      ? {
          url: assert_resolve_url(result.url, options),
          address: result.lightningAddress,
        }
      : {
          url: assert_resolve_url(result.url, options),
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
      url: assert_resolve_url(lightningAddress_to_url(address), options),
      address,
    };
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new InvalidLnurlError("URL input must use http or https");
    }
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
  const fetcher = getFetch(options.fetch);
  let response: Response;
  const { init, cleanup } = requestInit(options.headers, options);

  try {
    response = await fetcher(url, init);
  } catch (cause) {
    throw new NetworkError(`Failed to resolve LNURL-pay endpoint: ${url}`, { cause });
  } finally {
    cleanup();
  }

  assertRedirectPolicy(url, response, options);

  if (!response.ok) {
    throw new NetworkError(
      `Failed to resolve LNURL-pay endpoint: ${response.status} ${response.statusText}`,
    );
  }

  let raw: unknown;
  try {
    raw = await readJsonResponse(response);
  } catch (cause) {
    throw new InvalidPayRequestError("Resolved response is not valid JSON", { cause });
  }

  const parse_context = {
    sourceUrl: url,
    ...(options.allowOnion !== undefined ? { allowOnion: options.allowOnion } : {}),
    ...(address ? { lightningAddress: address } : {}),
  };

  return parsePayRequestResponse(raw, parse_context);
}
