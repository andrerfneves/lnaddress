import { fetchServiceKeys, parseServiceKeysResponse, serviceKeysUrl } from "../../src";

const signingKey = "031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f";
const encryptionKey = "024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766";

const mockServiceKeys = {
  domain: "example.com",
  signingKeys: [
    {
      id: "2026-q1-signing",
      algorithm: "secp256k1",
      publicKey: signingKey,
      certChain: ["-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"],
    },
  ],
  encryptionKeys: [
    {
      id: "2026-q1-encryption",
      algorithm: "secp256k1",
      publicKey: encryptionKey,
    },
  ],
};

console.log(serviceKeysUrl("example.com").toString());

const parsed = parseServiceKeysResponse(mockServiceKeys, {
  sourceUrl: "https://example.com/.well-known/lnurl-service",
});

console.log(parsed.signingKeys?.[0]?.id);
console.log(parsed.signingKeys?.[0]?.certChain?.length);

const fetched = await fetchServiceKeys("example.com", {
  fetch: async (input) => {
    console.log(`GET ${String(input)}`);
    return new Response(JSON.stringify(mockServiceKeys), {
      headers: { "content-type": "application/json" },
    });
  },
});

console.log(fetched.encryptionKeys?.[0]?.publicKey);
