# lnaddress

Lightning Address-first TypeScript client for LNURL-pay.

`lnaddress` makes the common Lightning Address flow tiny while keeping the typed primitives wallets, apps, and servers need for advanced LNURL-pay work.

```sh
bun i lnaddress
```

```ts
import { pay } from "lnaddress";

const payment = await pay("alice@example.com", {
  amountMsat: 10_000,
});

if (payment.type === "bolt11") {
  console.log(payment.pr);
}
```

## Why lnaddress

- Lightning Address first, LNURL-pay underneath.
- Small API surface: resolve, request, pay, verify, and service-key discovery.
- Native `fetch`, with custom fetch injection for apps, tests, and edge runtimes.
- Strict TypeScript types with discriminated payment instructions.
- Runtime validation for provider responses.
- No axios, no Node-only core APIs, no LNURL kitchen sink.

## Supported LUDs

| LUD | Feature | Status |
| --- | --- | --- |
| LUD-06 | LNURL-pay `payRequest` | Supported |
| LUD-09 | `successAction` parsing | Supported |
| LUD-12 | comments | Supported |
| LUD-16 | Lightning Address | Supported |
| LUD-18 | `payerData` | Supported |
| LUD-21 | verify URL | Supported |
| LUD-XX | `paymentOptions` for multi-rail pay | Supported |
| LUD-XX | `nodePubkeys` invoice-origin checks for `payRequest` | Supported |
| LUD-XX | domain service-key discovery at `/.well-known/lnurl-service` | Supported |

`lnaddress` intentionally does not implement withdraw, auth, hosted channels, channel requests, NWC, encrypted provider data, or keysend in v0.1.0.

## Quickstart: request a BOLT11 invoice

```ts
import { pay } from "lnaddress";

const payment = await pay("alice@example.com", {
  amountMsat: 25_000,
});

if (payment.type !== "bolt11") {
  throw new Error("Expected a BOLT11 invoice");
}

console.log(payment.pr);
```

## Resolve first, pay later

```ts
import { requestPayment, resolve } from "lnaddress";

const payRequest = await resolve("alice@example.com");

console.log(payRequest.description);
console.log(payRequest.minSendableMsat);
console.log(payRequest.maxSendableMsat);

const payment = await requestPayment(payRequest, {
  amountMsat: 50_000n,
});
```

## Lightning Address examples

```ts
import { isLightningAddress, parseLightningAddress, resolve } from "lnaddress";

isLightningAddress("alice@example.com"); // true

const address = parseLightningAddress("alice+shop@EXAMPLE.COM");
// { username: "alice+shop", domain: "example.com", address: "alice+shop@example.com" }

await resolve("alice@example.com");
// GET https://example.com/.well-known/lnurlp/alice
```

## LNURL examples

```ts
import { decodeLnurl, encodeLnurl, resolve } from "lnaddress";

const encoded = encodeLnurl("https://example.com/.well-known/lnurlp/alice");
const url = decodeLnurl(encoded);

await resolve(encoded);
await resolve("lnurlp://example.com/alice");
await resolve(url);
```

## Comments

```ts
import { requestPayment, resolve, validateComment } from "lnaddress";

const payRequest = await resolve("alice@example.com");

validateComment(payRequest, "thanks");

await requestPayment(payRequest, {
  amountMsat: 10_000,
  comment: "thanks",
});
```

If the provider does not advertise `commentAllowed`, comments are rejected before the callback request is sent.

## Payer Data

```ts
import { requestPayment, resolve, validateMandatoryPayerData } from "lnaddress";

const payRequest = await resolve("merchant@example.com");

validateMandatoryPayerData(payRequest, {
  name: "Alice",
  email: "alice@example.com",
});

await requestPayment(payRequest, {
  amountMsat: 100_000,
  payerData: {
    name: "Alice",
    email: "alice@example.com",
  },
});
```

`payerData` is passed through as provided. Fields that were not requested by the provider are not stripped.

## Verify

```ts
import { pay, verifyPayment } from "lnaddress";

const payment = await pay("alice@example.com", {
  amountMsat: 10_000,
});

const result = await verifyPayment(payment);

if (result.status === "OK" && result.settled) {
  console.log(result.preimage);
}
```

You can also verify by URL:

```ts
import { verifyPayment } from "lnaddress";

await verifyPayment("https://example.com/verify?k1=...");
```

## Payment Options

Providers may advertise multiple payment methods via the draft `paymentOptions` extension in the LUD-06 response. `lnaddress` parses them and lets you select one before the callback. The current v2 draft keeps `amount` in LUD-06 millisatoshis and treats `paymentOption` as method selection, not asset/quote selection.

```ts
import { requestPayment, resolve, validatePaymentOption } from "lnaddress";

const payRequest = await resolve("alice@example.com");

// See available options
console.log(payRequest.paymentOptions);
// [{ id: "lightning", type: "lightning" }, { id: "bolt12", type: "bolt12" }, { id: "liquid", type: "liquid" }]

// Select a non-Lightning option
validatePaymentOption(payRequest, "liquid");

const payment = await requestPayment(payRequest, {
  amountMsat: 25_000,
  paymentOption: "liquid",
});

if (payment.type === "destination") {
  console.log(payment.paymentOption);     // "liquid"
  console.log(payment.paymentDestination); // "lq1..."
  console.log(payment.paymentUri);          // "liquidnetwork:lq1..."
}
```

If `paymentOption` is absent, the normal LUD-06 Lightning flow is used. `validatePaymentOption` rejects unknown or unavailable options before the callback is sent. For `type: "lightning"`, callback responses must include `pr`; `pr` remains authoritative even if generic `paymentDestination` / `paymentURI` fields are also present. Non-`pr` options such as `bolt12`, `onchain`, `liquid`, `arkade`, `spark`, `bark`, or unknown future methods may return `paymentDestination`, `paymentURI`, or both. URI-only responses are accepted for methods whose complete wallet instruction is a URI/deeplink.

## Invoice-origin checks with nodePubkeys

The draft `nodePubkeys` LUD-XX proposal ([lnurl/luds#297](https://github.com/lnurl/luds/pull/297)) lets a provider advertise the Lightning node public keys that may generate invoices for a payRequest. `lnaddress` parses those keys and, when BOLT11 validation is enabled, compares the invoice payee node id against the advertised list.

```ts
import { requestPayment, resolve } from "lnaddress";

const payRequest = await resolve("alice@example.com");

if (payRequest.nodePubkeys) {
  console.log(payRequest.nodePubkeys.map((entry) => entry.pubkey));
}

const payment = await requestPayment(payRequest, {
  amountMsat: 25_000,
});

if (payment.type === "bolt11") {
  const verification = payment.nodePubkeyVerification;

  if (verification?.status === "verified") {
    console.log(`Invoice came from expected node ${verification.matchedPubkey}`);
  }

  if (verification?.status === "mismatch") {
    // Spec-compatible default: warn, but do not block user-controlled payment.
    console.warn(verification.warning);
  }
}

// Strict server-side or policy-driven callers can opt into blocking mismatches.
await requestPayment(payRequest, {
  amountMsat: 25_000,
  nodePubkeyPolicy: "enforce",
});
```

`nodePubkeyPolicy` defaults to `"warn"`: mismatches are returned as `payment.nodePubkeyVerification.status === "mismatch"` and the payment instruction is still returned. Use `"enforce"` to throw `NodePubkeyMismatchError`, or `"off"` to skip comparison while keeping the other BOLT11 checks. If an invoice omits the BOLT11 `n` tag, `lnaddress` recovers the signer pubkey from the invoice signature and marks `payeeNodeIdSource: "signature"`.

## Domain service-key discovery

The draft Domain Service Keys LUD-XX proposal lets a domain publish service-level signing and encryption public keys at `/.well-known/lnurl-service`. `lnaddress` can build the well-known URL, parse the document, and fetch it with the same network controls used by the LNURL-pay APIs.

```ts
import { fetchServiceKeys, parseServiceKeysResponse, serviceKeysUrl } from "lnaddress";

console.log(serviceKeysUrl("example.com").toString());
// https://example.com/.well-known/lnurl-service

const serviceKeys = await fetchServiceKeys("example.com");

for (const key of serviceKeys.signingKeys ?? []) {
  console.log(key.id, key.publicKey);
}

const parsed = parseServiceKeysResponse({
  domain: "example.com",
  signingKeys: [
    {
      id: "2026-q1-primary",
      algorithm: "secp256k1",
      publicKey: "031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f",
      certChain: ["-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"],
    },
  ],
});

console.log(parsed.signingKeys?.[0]?.certChain);
```

The base trust model is HTTPS origin binding plus required raw `publicKey` values. Optional per-key `certChain` values are preserved and lightly validated as PEM certificate strings, but certificate trust decisions remain caller/local-policy responsibilities. This LUD only discovers keys; companion LUDs define how those keys are used for signed LNURL messages or encrypted provider payloads.

## Destination Instructions

Some providers return payment destinations or URI-only payment instructions instead of BOLT11 invoices. `lnaddress` preserves those responses as a typed destination instruction. Treat destination strings and `paymentUri` as provider data until your application validates the target rail.

```ts
const payment = await pay("liquid@example.com", {
  amountMsat: 25_000,
});

if (payment.type === "destination") {
  console.log(payment.paymentDestination);
  console.log(payment.paymentUri);
  console.log(payment.verifyUrl);
}
```

The same shape works for BOLT12-style offers and destination rails such as onchain, Liquid, Arkade, Spark, or Bark when a provider returns `paymentDestination`, wire-field `paymentURI`, or both, plus optionally `verify`. Use `assertDestinationRail(payment, "liquid")`, `assertDestinationRail(payment, "onchain")`, or `destinationMatchesRail` when you need URI-scheme validation for known rails.

## Examples

This repository includes copy-pasteable examples and a richer mocked playground:

- `examples/basic`: small scripts for resolve, BOLT11 requests, comments, payer data, verify, destination payments, nodePubkeys, and domain service keys.
- `examples/payment-options`: standalone multi-rail `paymentOptions` explainer and mock provider.
- `examples/playground`: a Vite React playground with shadcn-style local components that exercises the library end to end against mocked provider flows.

```sh
bun examples/basic/resolve.ts

cd examples/playground
bun install
bun run dev
```

## Custom Fetch

```ts
import { resolve } from "lnaddress";

const payRequest = await resolve("alice@example.com", {
  fetch: async (input, init) => {
    return fetch(input, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers)),
        "user-agent": "my-wallet/1.0",
      },
    });
  },
});
```

## Network and provider controls

`resolve`, `requestPayment`, `pay`, `verifyPayment`, and `fetchServiceKeys` accept the same fetch controls:

```ts
await pay("alice@example.com", {
  amountMsat: 10_000,
  timeoutMs: 10_000,
  redirectPolicy: "same-origin",
  providerPolicy: "same-origin",
  nodePubkeyPolicy: "warn",
});
```

By default, `lnaddress` rejects `.onion`, localhost, loopback, link-local, and private-network HTTP(S) URLs. Opt in only when that is intentional:

```ts
await resolve("https://abcdefghijklmnop.onion/lnurlp/alice", { allowOnion: true });
await resolve("http://localhost:3000/.well-known/lnurlp/alice", { allowPrivateNetwork: true });
```

`redirectPolicy` is enforced before following redirects. `providerPolicy: "same-origin"` requires callback and verify URLs to stay on the resolved provider origin; `"same-site"` allows the same hostname or subdomain. Use a custom `fetch` for stricter DNS/IP allowlists, proxies, or runtime-specific SSRF controls.

## Error Handling

```ts
import {
  AmountOutOfRangeError,
  InvalidLightningAddressError,
  LnAddressError,
  pay,
} from "lnaddress";

try {
  await pay("alice@example.com", { amountMsat: 1 });
} catch (error) {
  if (error instanceof AmountOutOfRangeError) {
    console.error("Choose a larger amount");
  } else if (error instanceof InvalidLightningAddressError) {
    console.error("Check the address");
  } else if (error instanceof LnAddressError) {
    console.error(error.code, error.message);
  } else {
    throw error;
  }
}
```

## API Reference

### `resolve(input, options?)`

Accepts a Lightning Address, LNURL bech32 string, `lnurlp://` URI, or HTTP(S) URL and returns a `PayRequest`.

```ts
const payRequest = await resolve("alice@example.com", {
  fetch,
});
```

### `requestPayment(payRequestOrInput, options)`

Accepts a resolved `PayRequest` or any `resolve` input and returns a `PaymentInstruction`.

```ts
const payment = await requestPayment("alice@example.com", {
  amountMsat: 10_000,
  comment: "hi",
  payerData: { name: "Alice" },
  validateBolt11: true,
  validateMetadataHash: false,
  nodePubkeyPolicy: "warn",
});
```

### `pay(input, options)`

One-shot `resolve` plus `requestPayment`.

### `verifyPayment(paymentOrVerifyUrl, options?)`

Fetches a LUD-21 verify URL and returns a `VerifyResult`.

### Utilities

```ts
parseLightningAddress(address);
isLightningAddress(value);
decodeLnurl(lnurl);
encodeLnurl(url);
parseMetadata(metadataString);
getMetadataHash(metadataString);
validateCallbackAmount(payRequest, amountMsat);
validateComment(payRequest, comment);
validateMandatoryPayerData(payRequest, payerData);
validatePaymentOption(payRequest, paymentOption);
serviceKeysUrl(domainOrUrl);
parseServiceKeysResponse(raw, context);
fetchServiceKeys(domainOrUrl, options);
```

## Types

The public API uses camelCase for function names and object fields.

```ts
import type {
  DomainServiceKey,
  DomainServiceKeys,
  PayRequest,
  PaymentInstruction,
  PaymentOption,
  RequestPaymentOptions,
  VerifyResult,
} from "lnaddress";
```

`PaymentInstruction` is a discriminated union:

```ts
if (payment.type === "bolt11") {
  payment.pr;
} else {
  payment.paymentDestination;
}
```

## Compatibility

- Bun: primary package manager and test runner.
- Node.js: Node 18+ through native `fetch`.
- Browsers and edge runtimes: no Node-only APIs in core code.
- Package output: ESM-first with CJS compatibility through `exports.require`.

## Security Notes

- `metadataHash` is computed from the exact metadata string returned by the provider.
- `validateBolt11` is enabled by default and checks invoice structure, amount, network, expiry, signature, and payee node id when present.
- BOLT11 description-hash validation is opt-in with `validateMetadataHash: true` because current LUD-06 behavior no longer requires it by default.
- If a provider advertises `nodePubkeys`, BOLT11 payments include `nodePubkeyVerification` so wallets can show invoice-origin warnings. Mismatches are non-blocking by default (`nodePubkeyPolicy: "warn"`) and can be made strict with `"enforce"`.
- Domain service-key discovery validates flat `signingKeys` / `encryptionKeys` documents from `/.well-known/lnurl-service`; optional `certChain` metadata is preserved but not trusted beyond caller policy.
- LUD-09 AES success actions can be decrypted asynchronously with `decryptSuccessAction`.
- LUD-09 URL success actions and destination `paymentUri` values are untrusted provider data; do not fetch/open them without app-level policy.
- Always verify settlement with `verifyPayment` when the provider supplies a verify URL.

## Roadmap

- More destination-rail examples and validators as provider conventions stabilize.
- Public-suffix-aware same-site policy if callers need browser-style eTLD+1 semantics.
- Additional LUD coverage when it fits the small Lightning Address-first API.

## Contributing

```sh
bun install
bun run check
```

Useful scripts:

```sh
bun run test
bun run test:unit
bun run test:integration
bun run test:e2e
bun run test:examples
bun run test:package
bun run typecheck
bun run lint
bun run build
```

## Release Instructions

1. Update `CHANGELOG.md`.
2. Bump `package.json` with semver.
3. Create and push a tag like `v0.1.0`.
4. GitHub Actions publishes with npm provenance/trusted publishing.

Dry run locally:

```sh
bun run release:dry
```
