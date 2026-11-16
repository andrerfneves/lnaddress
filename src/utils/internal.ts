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

/**
 * Parse an IPv6 address into 16 bytes.
 * Returns undefined for invalid or non-IPv6 strings.
 * Handles bracketed forms ([::1]) and dotted-decimal IPv4-mapped suffixes.
 */
function parseIpv6Bytes(hostname: string): Uint8Array | undefined {
  let value = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();

  // Shortest valid IPv6 is "::" (2 chars); longest is 39 chars.
  if (value.length < 2 || value.length > 45) return undefined;

  // Reject characters outside IPv6 hex digits, colons, dots, and IPv4 suffix.
  if (!/^[0-9a-f:.]+$/.test(value)) return undefined;

  // Expand IPv4-mapped dotted-decimal suffix to hex groups.
  // e.g. ::ffff:192.168.0.1 → ::ffff:c0a8:1
  const lastColon = value.lastIndexOf(":");
  if (lastColon !== -1 && value.slice(lastColon + 1).includes(".")) {
    const suffix = value.slice(lastColon + 1);
    const ipv4 = parseIpv4(suffix);
    if (!ipv4) return undefined;
    const [a, b, c, d] = ipv4;
    const hi = ((a << 8) | b).toString(16);
    const lo = ((c << 8) | d).toString(16);
    value = `${value.slice(0, lastColon + 1) + hi}:${lo}`;
  }

  // Handle "::" expansion. Count colons to determine compression size.
  const groups = value.split(":");
  const hasDoubleColon = value.includes("::");

  if (hasDoubleColon) {
    // Multiple "::" is invalid.
    if (value.indexOf("::") !== value.lastIndexOf("::")) return undefined;

    // Count non-empty groups to figure out how many zero groups to insert.
    const nonEmpty = groups.filter((g) => g !== "");
    const zeroCount = 8 - nonEmpty.length;
    if (zeroCount < 1) return undefined;

    // Split at "::" and insert zero groups.
    const parts = value.split("::");
    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts[1] ? parts[1].split(":") : [];
    const expanded = [...left, ...Array(zeroCount).fill("0"), ...right];
    if (expanded.length !== 8) return undefined;
    return ipv6GroupsToBytes(expanded);
  }

  if (groups.length !== 8) return undefined;
  return ipv6GroupsToBytes(groups);
}

function ipv6GroupsToBytes(groups: string[]): Uint8Array | undefined {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const group = groups[i];
    if (!group || group.length === 0 || group.length > 4) return undefined;
    if (!/^[0-9a-f]+$/.test(group)) return undefined;
    const value = Number.parseInt(group, 16);
    if (!Number.isFinite(value) || value < 0 || value > 0xffff) return undefined;
    bytes[i * 2] = (value >> 8) & 0xff;
    bytes[i * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function isPrivateIpv6(hostname: string): boolean {
  const bytes = parseIpv6Bytes(hostname);
  if (!bytes) return false;

  // :: (unspecified) and ::1 (loopback)
  const isUnspecified = bytes.every((b) => b === 0);
  const isLoopback = bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1;
  if (isUnspecified || isLoopback) return true;

  // Link-local fe80::/10
  if ((bytes[0] ?? 0) === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return true;

  // Unique local addresses fc00::/7
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) return true;

  // IPv4-mapped IPv6: ::ffff:0:0/96 — first 10 bytes are 0, bytes 10-11 are 0xff
  const isIpv4Mapped =
    bytes.slice(0, 10).every((b) => b === 0) &&
    (bytes[10] ?? 0) === 0xff &&
    (bytes[11] ?? 0) === 0xff;

  if (isIpv4Mapped) {
    // Extract the embedded IPv4 address (last 4 bytes) and reuse isPrivateIpv4.
    const embedded = [bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0] as [
      number,
      number,
      number,
      number,
    ];
    return isPrivateIpv4(embedded);
  }

  // IPv4-compatible IPv6: ::x.x.x.x (deprecated but still resolves in some stacks).
  // First 12 bytes are 0, bytes 10-11 are also 0 (not 0xffff).
  const isIpv4Compatible =
    bytes.slice(0, 12).every((b) => b === 0) && (bytes[12] ?? 0) !== 0 && (bytes[13] ?? 0) !== 0;
  if (isIpv4Compatible) {
    const embedded = [bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0] as [
      number,
      number,
      number,
      number,
    ];
    return isPrivateIpv4(embedded);
  }

  return false;
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
