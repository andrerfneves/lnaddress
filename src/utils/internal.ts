import type { UrlSafetyOptions } from "../core/types";

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
