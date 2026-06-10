import { NetworkError } from "./errors";
import type { FetchControls, FetchLike, UrlSafetyOptions } from "./types";

export function get_fetch(fetcher?: FetchLike): FetchLike {
  const selected = fetcher ?? globalThis.fetch;

  if (!selected) {
    throw new NetworkError("No fetch implementation is available");
  }

  return selected.bind(globalThis) as FetchLike;
}

export function merge_headers(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  if (!merged.has("accept")) {
    merged.set("accept", "application/json");
  }
  return merged;
}

export function request_init(
  headers: HeadersInit | undefined,
  options: FetchControls,
): { init: RequestInit; cleanup: () => void } {
  const init: RequestInit = {
    headers: merge_headers(headers),
  };
  const cleanup_callbacks: Array<() => void> = [];

  if (options.timeout_ms !== undefined) {
    if (!Number.isSafeInteger(options.timeout_ms) || options.timeout_ms <= 0) {
      throw new NetworkError("timeout_ms must be a positive safe integer");
    }

    const controller = new AbortController();
    init.signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(), options.timeout_ms);
    cleanup_callbacks.push(() => clearTimeout(timeout));

    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        const abort = () => controller.abort();
        options.signal.addEventListener("abort", abort, { once: true });
        cleanup_callbacks.push(() => options.signal?.removeEventListener("abort", abort));
      }
    }
  } else if (options.signal) {
    init.signal = options.signal;
  }

  return {
    init,
    cleanup: () => {
      for (const cleanup of cleanup_callbacks) {
        cleanup();
      }
    },
  };
}

export function assert_redirect_policy(
  request_url: URL | string,
  response: Response,
  options: FetchControls,
): void {
  const policy = options.redirect_policy ?? "follow";
  if (policy === "follow" || !response.redirected || !response.url) {
    return;
  }

  if (policy === "error") {
    throw new NetworkError("Redirected responses are disabled by redirect_policy");
  }

  const original = new URL(String(request_url));
  const final = new URL(response.url);

  if (policy === "same-origin" && final.origin !== original.origin) {
    throw new NetworkError("Redirected response changed origin");
  }

  if (policy === "no-downgrade" && original.protocol === "https:" && final.protocol === "http:") {
    throw new NetworkError("Redirected response downgraded from https to http");
  }
}

export function parse_json_object(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${label} must be an object`);
  }

  return raw as Record<string, unknown>;
}

export function read_string(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

export function read_boolean(raw: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return undefined;
}

export function read_unknown(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in raw) {
      return raw[key];
    }
  }

  return undefined;
}

export function assert_http_url(url: string, _options: UrlSafetyOptions = {}): URL {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new TypeError(`Invalid URL: ${url}`, { cause });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`URL must use http or https: ${url}`);
  }

  return parsed;
}

export async function read_json_response(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new TypeError("Response body is not valid JSON", { cause });
  }
}

export function amount_to_msat_string(amount_msat: number | bigint): string {
  if (typeof amount_msat === "bigint") {
    if (amount_msat < 0n) {
      throw new TypeError("amount_msat must be non-negative");
    }
    return amount_msat.toString();
  }

  if (!Number.isSafeInteger(amount_msat) || amount_msat < 0) {
    throw new TypeError("amount_msat must be a non-negative safe integer");
  }

  return String(amount_msat);
}

export function to_msat_bigint(value: unknown, field: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new TypeError(`${field} must be non-negative`);
    }
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${field} must be a non-negative safe integer`);
    }
    return BigInt(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  throw new TypeError(`${field} must be an integer millisatoshi amount`);
}

export function unknown_to_record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
