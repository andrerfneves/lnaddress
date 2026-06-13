import { Point } from "@noble/secp256k1";
import { InvalidServiceKeysError, NetworkError } from "./errors";
import {
  assertHttpUrl,
  assertRedirectPolicy,
  fetchWithRedirectPolicy,
  getFetch,
  readJsonResponse,
  requestInit,
  unknownToRecord,
} from "./internal";
import type {
  DomainServiceKey,
  DomainServiceKeyAlgorithm,
  DomainServiceKeys,
  FetchServiceKeysOptions,
  ParseServiceKeysContext,
  UrlSafetyOptions,
} from "./types";

export const LNURL_SERVICE_PATH = "/.well-known/lnurl-service";

const compressedSecp256k1PubkeyPattern = /^(02|03)[0-9a-f]{64}$/i;

function normalizeDomain(value: string): string {
  return value.toLowerCase().replace(/\.$/, "");
}

function serviceKeysError(message: string, cause?: unknown): InvalidServiceKeysError {
  return new InvalidServiceKeysError(message, cause === undefined ? undefined : { cause });
}

export function serviceKeysUrl(input: string, options: UrlSafetyOptions = {}): URL {
  const value = input.trim();
  if (!value) {
    throw new InvalidServiceKeysError("Service keys domain or URL is required");
  }

  try {
    if (/^https?:\/\//i.test(value)) {
      return assertHttpUrl(value, options);
    }

    if (/[/?#@\\]/.test(value)) {
      throw new TypeError("domain input must not include a path, query, fragment, or userinfo");
    }

    const parsed = new URL(`https://${value}`);
    parsed.hostname = normalizeDomain(parsed.hostname);
    parsed.pathname = LNURL_SERVICE_PATH;
    parsed.search = "";
    parsed.hash = "";
    return assertHttpUrl(parsed.toString(), options);
  } catch (cause) {
    throw serviceKeysError("Invalid LNURL service keys domain or URL", cause);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const record = unknownToRecord(value);
  if (!record) {
    throw new InvalidServiceKeysError(`${label} must be an object`);
  }
  return record;
}

function normalizePublicKey(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new InvalidServiceKeysError(`${label} must be a string`);
  }

  const normalized = value.toLowerCase();
  if (!compressedSecp256k1PubkeyPattern.test(normalized)) {
    throw new InvalidServiceKeysError(
      `${label} must be a compressed secp256k1 public key encoded as 66 hex characters`,
    );
  }

  try {
    Point.fromHex(normalized).assertValidity();
  } catch (cause) {
    throw new InvalidServiceKeysError(`${label} must be a valid secp256k1 public key`, {
      cause,
    });
  }

  return normalized;
}

function parseExpiresAt(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InvalidServiceKeysError(`${label} must be a non-negative UNIX timestamp`);
  }

  return value as number;
}

function parseAlgorithm(value: unknown, label: string): DomainServiceKeyAlgorithm {
  if (value !== "secp256k1") {
    throw new InvalidServiceKeysError(`${label} must be secp256k1`);
  }

  return value;
}

function isPemCertificate(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("-----BEGIN CERTIFICATE-----") &&
    trimmed.endsWith("-----END CERTIFICATE-----")
  );
}

function parseCertChain(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new InvalidServiceKeysError(`${label} must be an array`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || !isPemCertificate(entry)) {
      throw new InvalidServiceKeysError(`${label}[${index}] must be a PEM-encoded certificate`);
    }
    return entry;
  });
}

function parseKeyArray(value: unknown, label: string): DomainServiceKey[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new InvalidServiceKeysError(`${label} must be an array`);
  }

  const seenIds = new Set<string>();
  const keys: DomainServiceKey[] = [];

  for (const [index, entry] of value.entries()) {
    const raw = requireRecord(entry, `${label}[${index}]`);

    if (typeof raw.id !== "string" || raw.id.trim() === "") {
      throw new InvalidServiceKeysError(`${label}[${index}].id must be a non-empty string`);
    }
    const id = raw.id;
    if (seenIds.has(id)) {
      throw new InvalidServiceKeysError(`${label} contains duplicate key id: ${id}`);
    }
    seenIds.add(id);

    const key: DomainServiceKey = {
      id,
      algorithm: parseAlgorithm(raw.algorithm, `${label}[${index}].algorithm`),
      publicKey: normalizePublicKey(raw.publicKey, `${label}[${index}].publicKey`),
      raw,
    };

    const expiresAt = parseExpiresAt(raw.expiresAt, `${label}[${index}].expiresAt`);
    if (expiresAt !== undefined) {
      key.expiresAt = expiresAt;
    }

    const certChain = parseCertChain(raw.certChain, `${label}[${index}].certChain`);
    if (certChain !== undefined) {
      key.certChain = certChain;
    }

    keys.push(key);
  }

  return keys;
}

function assertDomainMatchesSource(domain: string, sourceUrl: string): void {
  let source: URL;
  try {
    source = new URL(sourceUrl);
  } catch (cause) {
    throw serviceKeysError("Service keys sourceUrl is invalid", cause);
  }

  if (normalizeDomain(domain) !== normalizeDomain(source.hostname)) {
    throw new InvalidServiceKeysError(
      `Service keys domain ${domain} does not match source host ${source.hostname}`,
    );
  }
}

export function parseServiceKeysResponse(
  raw: unknown,
  context: ParseServiceKeysContext = {},
): DomainServiceKeys {
  const record = requireRecord(raw, "service keys response");

  let domain: string | undefined;
  if (record.domain !== undefined) {
    if (typeof record.domain !== "string" || record.domain.trim() === "") {
      throw new InvalidServiceKeysError("domain must be a non-empty string when present");
    }
    domain = normalizeDomain(record.domain);
    if (context.sourceUrl) {
      assertDomainMatchesSource(domain, context.sourceUrl);
    }
  }

  const signingKeys = parseKeyArray(record.signingKeys, "signingKeys");
  const encryptionKeys = parseKeyArray(record.encryptionKeys, "encryptionKeys");
  const hasUsableKeys = Boolean(signingKeys?.length || encryptionKeys?.length);
  if (!hasUsableKeys) {
    throw new InvalidServiceKeysError(
      "service keys response must include non-empty signingKeys or encryptionKeys",
    );
  }

  return {
    ...(domain !== undefined ? { domain } : {}),
    ...(signingKeys !== undefined ? { signingKeys } : {}),
    ...(encryptionKeys !== undefined ? { encryptionKeys } : {}),
    ...(context.sourceUrl !== undefined ? { sourceUrl: context.sourceUrl } : {}),
    raw: record,
  };
}

export async function fetchServiceKeys(
  domainOrUrl: string,
  options: FetchServiceKeysOptions = {},
): Promise<DomainServiceKeys> {
  const url = serviceKeysUrl(domainOrUrl, options);
  const fetcher = getFetch(options.fetch);
  const { init, cleanup } = requestInit(options.headers, options);
  let response: Response;

  try {
    response = await fetchWithRedirectPolicy(fetcher, url, init, options);
  } catch (cause) {
    throw new NetworkError(`Failed to fetch LNURL service keys: ${url.toString()}`, { cause });
  } finally {
    cleanup();
  }

  assertRedirectPolicy(url, response, options);

  if (!response.ok) {
    throw new NetworkError(
      `Failed to fetch LNURL service keys: ${response.status} ${response.statusText}`,
    );
  }

  let body: unknown;
  try {
    body = await readJsonResponse(response);
  } catch (cause) {
    throw new InvalidServiceKeysError("LNURL service keys response is not valid JSON", { cause });
  }

  return parseServiceKeysResponse(body, { sourceUrl: url.toString() });
}
