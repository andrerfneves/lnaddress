import {
  InvalidLightningAddressError,
  InvalidLnurlError,
  InvalidPayRequestError,
  NetworkError,
} from "./errors";
import { assert_http_url, get_fetch, merge_headers, read_json_response } from "./internal";
import { parse_lightning_address } from "./lightning-address";
import { decode_lnurl } from "./lnurl";
import { parse_pay_request_response } from "./payrequest";
import type { LightningAddress, PayRequest, ResolveOptions } from "./types";

function lightning_address_to_url(lightning_address: LightningAddress): string {
  return `https://${lightning_address.domain}/.well-known/lnurlp/${encodeURIComponent(
    lightning_address.username,
  )}`;
}

function assert_resolve_url(url: string, options: ResolveOptions): string {
  try {
    return assert_http_url(url, options).toString();
  } catch (cause) {
    throw new InvalidLnurlError("Generated LNURL-pay endpoint URL is invalid", { cause });
  }
}

function lnurlp_uri_to_url(input: string): { url: string; lightning_address?: LightningAddress } {
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
    const lightning_address = parse_lightning_address(`${parsed.username}@${parsed.hostname}`);
    return {
      url: lightning_address_to_url(lightning_address),
      lightning_address,
    };
  }

  const pathname = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));

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

function input_to_url(
  input: string,
  options: ResolveOptions,
): { url: string; address?: LightningAddress } {
  const value = input.trim();
  const lower = value.toLowerCase();

  if (lower.startsWith("lnurlp://")) {
    const result = lnurlp_uri_to_url(value);
    return result.lightning_address
      ? {
          url: assert_resolve_url(result.url, options),
          address: result.lightning_address,
        }
      : {
          url: assert_resolve_url(result.url, options),
        };
  }

  if (lower.startsWith("lnurl")) {
    return {
      url: decode_lnurl(value, options),
    };
  }

  if (!value.includes("://") && value.includes("@")) {
    const address = parse_lightning_address(value);
    return {
      url: assert_resolve_url(lightning_address_to_url(address), options),
      address,
    };
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new InvalidLnurlError("URL input must use http or https");
    }
    if (!options.allow_onion && parsed.hostname.toLowerCase().endsWith(".onion")) {
      throw new InvalidLnurlError("Onion URLs are disabled by default");
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
  const { url, address } = input_to_url(input, options);
  const fetcher = get_fetch(options.fetch);
  let response: Response;

  try {
    response = await fetcher(url, {
      headers: merge_headers(options.headers),
    });
  } catch (cause) {
    throw new NetworkError(`Failed to resolve LNURL-pay endpoint: ${url}`, { cause });
  }

  if (!response.ok) {
    throw new NetworkError(
      `Failed to resolve LNURL-pay endpoint: ${response.status} ${response.statusText}`,
    );
  }

  let raw: unknown;
  try {
    raw = await read_json_response(response);
  } catch (cause) {
    throw new InvalidPayRequestError("Resolved response is not valid JSON", { cause });
  }

  const parse_context = {
    source_url: url,
    ...(options.allow_onion !== undefined ? { allow_onion: options.allow_onion } : {}),
    ...(address ? { lightning_address: address } : {}),
  };

  return parse_pay_request_response(raw, parse_context);
}
