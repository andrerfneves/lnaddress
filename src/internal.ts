import { NetworkError } from "./errors";
import type { FetchControls, FetchLike, UrlSafetyOptions } from "./types";

export function getFetch(fetcher?: FetchLike): FetchLike {
  const selected = fetcher ?? globalThis.fetch;

  if (!selected) {
    throw new NetworkError("No fetch implementation is available");
  }

  return selected.bind(globalThis) as FetchLike;
}

export function mergeHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  if (!merged.has("accept")) {
    merged.set("accept", "application/json");
  }
  return merged;
}

export function requestInit(
  headers: HeadersInit | undefined,
  options: FetchControls,
): { init: RequestInit; cleanup: () => void } {
  const init: RequestInit = {
    headers: mergeHeaders(headers),
  };
  const cleanupCallbacks: Array<() => void> = [];

  if (options.timeoutMs !== undefined) {
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new NetworkError("timeoutMs must be a positive safe integer");
    }

    const controller = new AbortController();
    init.signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    cleanupCallbacks.push(() => clearTimeout(timeout));

    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        const abort = () => controller.abort();
        options.signal.addEventListener("abort", abort, { once: true });
        cleanupCallbacks.push(() => options.signal?.removeEventListener("abort", abort));
      }
    }
  } else if (options.signal) {
    init.signal = options.signal;
  }

  return {
    init,
    cleanup: () => {
      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }
    },
  };
}

export function assertRedirectPolicy(
  requestUrl: URL | string,
  response: Response,
  options: FetchControls,
): void {
  const policy = options.redirectPolicy ?? "follow";
  if (policy === "follow" || !response.redirected || !response.url) {
    return;
  }

  if (policy === "error") {
    throw new NetworkError("Redirected responses are disabled by redirectPolicy");
  }

  const original = new URL(String(requestUrl));
  const final = new URL(response.url);

  if (policy === "same-origin" && final.origin !== original.origin) {
    throw new NetworkError("Redirected response changed origin");
  }

  if (policy === "no-downgrade" && original.protocol === "https:" && final.protocol === "http:") {
    throw new NetworkError("Redirected response downgraded from https to http");
  }
}

export function parseJsonObject(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${label} must be an object`);
  }

  return raw as Record<string, unknown>;
}

export function readString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

export function readBoolean(raw: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return undefined;
}

export function readUnknown(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in raw) {
      return raw[key];
    }
  }

  return undefined;
}

export function assertHttpUrl(url: string, _options: UrlSafetyOptions = {}): URL {
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

export async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new TypeError("Response body is not valid JSON", { cause });
  }
}

export function amountToMsatString(amountMsat: number | bigint): string {
  if (typeof amountMsat === "bigint") {
    if (amountMsat < 0n) {
      throw new TypeError("amountMsat must be non-negative");
    }
    return amountMsat.toString();
  }

  if (!Number.isSafeInteger(amountMsat) || amountMsat < 0) {
    throw new TypeError("amountMsat must be a non-negative safe integer");
  }

  return String(amountMsat);
}

export function toMsatBigint(value: unknown, field: string): bigint {
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

export function unknownToRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
