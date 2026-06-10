import { NetworkError } from "./errors";
import type { FetchLike, UrlSafetyOptions } from "./types";

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
