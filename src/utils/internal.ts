import { NetworkError } from "../core/errors";
import type { FetchControls, FetchLike, UrlSafetyOptions } from "../core/types";

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

  if ((options.redirectPolicy ?? "follow") !== "follow") {
    init.redirect = "manual";
  }

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

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function redirectLocation(requestUrl: URL | string, response: Response): URL | undefined {
  if (!isRedirectStatus(response.status)) {
    return undefined;
  }

  const location = response.headers.get("location");
  if (!location) {
    return undefined;
  }

  return new URL(location, String(requestUrl));
}

function assertRedirectTarget(
  originalUrl: URL,
  targetUrl: URL,
  policy: NonNullable<FetchControls["redirectPolicy"]>,
): void {
  if (policy === "error") {
    throw new NetworkError("Redirected responses are disabled by redirectPolicy");
  }

  if (policy === "same-origin" && targetUrl.origin !== originalUrl.origin) {
    throw new NetworkError("Redirect target changed origin");
  }

  if (
    policy === "no-downgrade" &&
    originalUrl.protocol === "https:" &&
    targetUrl.protocol === "http:"
  ) {
    throw new NetworkError("Redirect target downgraded from https to http");
  }
}

export async function fetchWithRedirectPolicy(
  fetcher: FetchLike,
  requestUrl: URL | string,
  init: RequestInit,
  options: FetchControls & UrlSafetyOptions,
): Promise<Response> {
  const policy = options.redirectPolicy ?? "follow";
  if (policy === "follow") {
    return fetcher(requestUrl, init);
  }

  const original = new URL(String(requestUrl));
  let current = original;

  for (let redirects = 0; redirects <= 20; redirects += 1) {
    const response = await fetcher(current, init);
    const target = redirectLocation(current, response);

    if (!target) {
      if (response.redirected && response.url) {
        const final = assertHttpUrl(response.url, options);
        assertRedirectTarget(original, final, policy);
      }
      return response;
    }

    const safeTarget = assertHttpUrl(target.toString(), options);
    assertRedirectTarget(original, safeTarget, policy);
    current = safeTarget;
  }

  throw new NetworkError("Too many redirects");
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

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function parseIpv4(hostname: string): [number, number, number, number] | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return undefined;
  }

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      return Number.NaN;
    }
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });

  if (octets.some((value) => Number.isNaN(value))) {
    return undefined;
  }

  return octets as [number, number, number, number];
}

function isPrivateIpv4([first, second]: [number, number, number, number]): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const value = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fe80:") ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("::ffff:127.") ||
    value.startsWith("::ffff:10.") ||
    value.startsWith("::ffff:192.168.")
  );
}

function isPrivateNetworkHost(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  const ipv4 = parseIpv4(host);
  if (ipv4) {
    return isPrivateIpv4(ipv4);
  }

  return host.includes(":") && isPrivateIpv6(host);
}

function isOnionHost(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  return host === "onion" || host.endsWith(".onion");
}

export function assertHttpUrl(url: string, options: UrlSafetyOptions = {}): URL {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new TypeError(`Invalid URL: ${url}`, { cause });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`URL must use http or https: ${url}`);
  }

  if (!options.allowOnion && isOnionHost(parsed.hostname)) {
    throw new TypeError(`Onion URLs require allowOnion: ${url}`);
  }

  if (!options.allowPrivateNetwork && isPrivateNetworkHost(parsed.hostname)) {
    throw new TypeError(`Private or local network URLs require allowPrivateNetwork: ${url}`);
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
