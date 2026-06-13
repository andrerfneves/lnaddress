import {
  InvalidLightningAddressError,
  InvalidLnurlError,
  InvalidPayRequestError,
  NetworkError,
} from "./errors";
import {
  assert_http_url,
  assert_redirect_policy,
  get_fetch,
  read_json_response,
  request_init,
} from "./internal";
import { parseLightningAddress } from "./lightning-address";
import { decodeLnurl } from "./lnurl";
import { parsePayRequestResponse } from "./payrequest";
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
    const lightning_address = parseLightningAddress(`${parsed.username}@${parsed.hostname}`);
    return {
      url: lightning_address_to_url(lightning_address),
      lightning_address,
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
      url: decodeLnurl(value, options),
    };
  }

  if (!value.includes("://") && value.includes("@")) {
    const address = parseLightningAddress(value);
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
  const { init, cleanup } = request_init(options.headers, options);

  try {
    response = await fetcher(url, init);
  } catch (cause) {
    throw new NetworkError(`Failed to resolve LNURL-pay endpoint: ${url}`, { cause });
  } finally {
    cleanup();
  }

  assert_redirect_policy(url, response, options);

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

  return parsePayRequestResponse(raw, parse_context);
}
