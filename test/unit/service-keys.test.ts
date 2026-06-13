import { describe, expect, test } from "bun:test";
import { InvalidServiceKeysError, parseServiceKeysResponse, serviceKeysUrl } from "../../src";

const signingKey = "031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f";
const encryptionKey = "024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766";
const cert = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----";

const validSigningKey = {
  id: "2026-q1-primary",
  algorithm: "secp256k1",
  publicKey: signingKey.toUpperCase(),
  expiresAt: 1_770_000_000,
  certChain: [cert],
  extra: "preserved",
};

const validEncryptionKey = {
  id: "2026-q1-primary",
  algorithm: "secp256k1",
  publicKey: encryptionKey,
  expiresAt: 1_770_000_000,
};

const validServiceKeys = {
  domain: "example.com",
  signingKeys: [validSigningKey],
  encryptionKeys: [validEncryptionKey],
  extraTopLevel: true,
};

describe("serviceKeysUrl", () => {
  test("builds the fixed lnurl-service well-known URL from a domain", () => {
    expect(serviceKeysUrl("example.com").toString()).toBe(
      "https://example.com/.well-known/lnurl-service",
    );
    expect(serviceKeysUrl("Example.COM.").toString()).toBe(
      "https://example.com/.well-known/lnurl-service",
    );
  });

  test("accepts an explicit http(s) service URL", () => {
    expect(serviceKeysUrl("https://example.com/custom/service.json").toString()).toBe(
      "https://example.com/custom/service.json",
    );
  });

  test("rejects unsafe host-like inputs", () => {
    expect(() => serviceKeysUrl("example.com/path")).toThrow(InvalidServiceKeysError);
    expect(() => serviceKeysUrl("http://localhost/.well-known/lnurl-service")).toThrow(
      InvalidServiceKeysError,
    );
    expect(() =>
      serviceKeysUrl("http://localhost/.well-known/lnurl-service", {
        allowPrivateNetwork: true,
      }),
    ).not.toThrow();
  });
});

describe("parseServiceKeysResponse", () => {
  test("parses flat signingKeys and encryptionKeys while preserving optional certChain and raw fields", () => {
    const parsed = parseServiceKeysResponse(validServiceKeys, {
      sourceUrl: "https://example.com/.well-known/lnurl-service",
    });
    expect(parsed.domain).toBe("example.com");
    expect(parsed.sourceUrl).toBe("https://example.com/.well-known/lnurl-service");
    expect(parsed.signingKeys).toEqual([
      {
        id: "2026-q1-primary",
        algorithm: "secp256k1",
        publicKey: signingKey,
        expiresAt: 1_770_000_000,
        certChain: [cert],
        raw: validSigningKey,
      },
    ]);
    expect(parsed.encryptionKeys?.[0]).toMatchObject({
      id: "2026-q1-primary",
      algorithm: "secp256k1",
      publicKey: encryptionKey,
      expiresAt: 1_770_000_000,
    });
    expect(parsed.raw).toBe(validServiceKeys);
  });

  test("allows one empty key-use array when the other contains keys", () => {
    const parsed = parseServiceKeysResponse({
      signingKeys: [],
      encryptionKeys: validServiceKeys.encryptionKeys,
    });

    expect(parsed.signingKeys).toEqual([]);
    expect(parsed.encryptionKeys).toHaveLength(1);
  });

  test("rejects documents without any usable key arrays", () => {
    expect(() => parseServiceKeysResponse({})).toThrow(InvalidServiceKeysError);
    expect(() => parseServiceKeysResponse({ signingKeys: [], encryptionKeys: [] })).toThrow(
      InvalidServiceKeysError,
    );
  });

  test("rejects domain mismatches against the source URL host", () => {
    expect(() =>
      parseServiceKeysResponse(
        { ...validServiceKeys, domain: "attacker.example" },
        { sourceUrl: "https://example.com/.well-known/lnurl-service" },
      ),
    ).toThrow(InvalidServiceKeysError);
  });

  test("rejects invalid key object fields", () => {
    expect(() =>
      parseServiceKeysResponse({ signingKeys: [{ ...validSigningKey, id: "" }] }),
    ).toThrow(InvalidServiceKeysError);
    expect(() =>
      parseServiceKeysResponse({
        signingKeys: [{ ...validSigningKey, algorithm: "ed25519" }],
      }),
    ).toThrow(InvalidServiceKeysError);
    expect(() =>
      parseServiceKeysResponse({
        signingKeys: [{ ...validSigningKey, publicKey: "02ff" }],
      }),
    ).toThrow(InvalidServiceKeysError);
    expect(() =>
      parseServiceKeysResponse({
        signingKeys: [{ ...validSigningKey, expiresAt: -1 }],
      }),
    ).toThrow(InvalidServiceKeysError);
    expect(() =>
      parseServiceKeysResponse({
        signingKeys: [{ ...validSigningKey, certChain: [123] }],
      }),
    ).toThrow(InvalidServiceKeysError);
  });

  test("rejects duplicate key ids within the same key-use array only", () => {
    expect(() =>
      parseServiceKeysResponse({
        signingKeys: [validSigningKey, { ...validSigningKey }],
      }),
    ).toThrow(InvalidServiceKeysError);

    expect(() =>
      parseServiceKeysResponse({
        signingKeys: [validSigningKey],
        encryptionKeys: [{ ...validEncryptionKey, id: validSigningKey.id }],
      }),
    ).not.toThrow();
  });
});
