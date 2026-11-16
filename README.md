# lnaddress

Lightning Address-first TypeScript client for LNURL-pay.

`lnaddress` makes the common Lightning Address flow tiny while keeping the typed primitives wallets, apps, and servers need for advanced LNURL-pay work.

```sh
bun add lnaddress
# or: npm install lnaddress / pnpm add lnaddress
```

> **Pre-release:** `lnaddress` has not been published to npm yet. The first release is published from a `v*` tag (see [Release Instructions](#release-instructions)). Until then, build it from this repository (`bun install && bun run build`).

```ts
import { pay } from "lnaddress";

const payment = await pay("alice@example.com", {
  amountMsat: 10_000,
});

if (payment.type === "bolt11") {
  console.log(payment.pr);
}
```

## Contents

- [Why lnaddress](#why-lnaddress) · [Supported LUDs](#supported-luds) · [Quickstart](#quickstart-request-a-bolt11-invoice)
- Flow: [Resolve first, pay later](#resolve-first-pay-later) · [Comments](#comments) · [Payer Data](#payer-data) · [Verify](#verify)
- Extensions: [Payment Options](#payment-options) · [PaymentQuote units](#paymentquote-units-and-quotes) · [nodePubkeys](#invoice-origin-checks-with-nodepubkeys) · [Service keys](#domain-service-key-discovery) · [Destinations](#destination-instructions)
- Operations: [Network and provider controls](#network-and-provider-controls) · [Error Handling](#error-handling) · [API Reference](#api-reference) · [Compatibility](#compatibility) · [Security Notes](#security-notes) · [Known limitations](#known-limitations)

## Why lnaddress

- Lightning Address first, LNURL-pay underneath.
- Small API surface: resolve, request, pay, verify, and service-key discovery.
- Native `fetch`, with custom fetch injection for apps, tests, and edge runtimes.
- Strict TypeScript types with discriminated payment instructions.
- Runtime validation for provider responses, including BOLT11 invoice checks by default.
- Two small runtime dependencies (`js-sha256`, `zod`; `@noble/secp256k1` is bundled), no Node-only APIs, no LNURL kitchen sink.

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
| LUD-XX | `paymentQuote` units, receive units, and quote details | Supported |
| LUD-XX | `nodePubkeys` invoice-origin checks for `payRequest` | Supported |
| LUD-XX | domain service-key discovery at `/.well-known/lnurl-service` | Supported |

`LUD-XX` rows are draft proposals that have no LUD number yet; their wire format may still change.

`lnaddress` intentionally does not implement withdraw, auth, hosted channels, channel requests, NWC, encrypted provider data, or keysend.

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
  console.log(result.preimageVerified); // true: sha256(preimage) matched the invoice payment hash
}
```

When you pass a BOLT11 payment instruction, `verifyPayment` checks the provider's answer against the invoice. If the response echoes a `pr` that isn't the invoice you requested, or returns a preimage that doesn't hash to the invoice's payment hash, it throws `VerifyError`. A verified preimage sets `preimageVerified: true`. When verifying by URL, the preimage is checked against the `pr` in the response, if there is one.

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

## PaymentQuote units and quotes

The draft `paymentQuote` extension uses generic `units`, `unit`, `receiveUnit`, and `paymentQuote` fields. `lnaddress` parses top-level and option-level `units`, validates unit-denominated requests before callback, requires `paymentQuote` whenever `unitAmount` or `receiveUnit` is used, and exposes parsed quote details on payment and verify results.

```ts
import { requestPayment, resolve, validateUnit } from "lnaddress";

const payRequest = await resolve("merchant@example.com");

// Top-level units apply to the default flow. Option-level units override them.
console.log(payRequest.units);
console.log(payRequest.paymentOptions?.find((option) => option.id === "liquid-usdt")?.units);

validateUnit(payRequest, "USD", "liquid-usdt", { amount: 10_000 });
validateUnit(payRequest, "USDT", "liquid-usdt");

const payment = await requestPayment(payRequest, {
  unitAmount: { amount: 10_000, unit: "USD" }, // 100.00 USD when decimals=2
  receiveUnit: "USDT",
  paymentOption: "liquid-usdt",
});

console.log(payment.paymentQuote);
// {
//   id: "quote_123",
//   requested: { amount: "10000", unit: "USD" },
//   payment: { amount: "10025000", unit: "USDT" },
//   receive: { amount: "10000000", unit: "USDT" },
//   fees: [{ amount: "25000", unit: "USDT", description: "Liquid settlement fee" }]
// }
```

If `unitAmount` is absent, `amountMsat` keeps normal LUD-06 millisatoshi semantics. You may still pass `receiveUnit` with `amountMsat`; the callback will include `receiveUnit=<code>` and the returned `paymentQuote.requested.unit` must be `"msat"`.

For BOLT11 responses to `unitAmount` requests, `paymentQuote.payment.unit` must be `"msat"`; invoice validation checks the BOLT11 amount against `paymentQuote.payment.amount`.

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
- `examples/payment-options`: standalone multi-rail `paymentOptions` + `paymentQuote` explainer and mock provider.
- `examples/playground`: a Vite React playground with shadcn-style local components that exercises the library end to end against mocked provider flows.

```sh
bun examples/basic/resolve.ts
bun examples/basic/pay-bolt11.ts

cd examples/playground
bun install
bun run dev
```

The basic scripts use a local mocked provider that signs real BOLT11 invoices, so they run with default validation on. `bun run test:examples` type-checks and runs all of them.

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

const quoted = await requestPayment("merchant@example.com", {
  unitAmount: { amount: 10_000, unit: "USD" },
  receiveUnit: "USDT",
  paymentOption: "liquid-usdt",
});
```

By default, `lnaddress` rejects `.onion`, localhost, loopback, link-local, and private-network HTTP(S) URLs. These checks look at the URL string only; hostnames are not resolved to IPs. Opt in only when that is intentional:

```ts
await resolve("https://abcdefghijklmnop.onion/lnurlp/alice", { allowOnion: true });
await resolve("http://localhost:3000/.well-known/lnurlp/alice", { allowPrivateNetwork: true });
```

| Option | Default | Behavior |
| --- | --- | --- |
| `redirectPolicy` | `"follow"` | Redirects are followed by `lnaddress` itself (up to 20 hops), and every target is checked against the onion/private-network rules *before* it is requested. `"same-origin"` also rejects origin changes, `"no-downgrade"` rejects HTTPS→HTTP, and `"error"` rejects any redirect. `Authorization`, `Proxy-Authorization`, and `Cookie` headers are dropped when a redirect changes origin. |
| `timeoutMs` | none | Aborts the request if the full response, headers and body, has not arrived in time. |
| `signal` | none | Caller-controlled cancellation, including while the body is read. Combined with `timeoutMs` when both are set. |
| `maxResponseBytes` | `1048576` (1 MiB) | Rejects larger response bodies, checking `Content-Length` first and then the bytes actually read. |
| `providerPolicy` | `"off"` | `"same-origin"` requires callback and verify URLs to stay on the resolved provider origin; `"same-site"` allows the same hostname or a subdomain (not eTLD+1). |
| `allowOnion` / `allowPrivateNetwork` | `false` | Opt-ins for Tor and local/private hosts. |

The private-network checks look at hostnames and IP literals, not DNS results. For server-side code that handles untrusted input, also use a custom `fetch` for DNS/IP allowlists, proxies, or runtime-specific SSRF controls.

Browsers hide redirect targets from `redirect: "manual"` (an opaque response). When that happens, `lnaddress` repeats the request with native redirect handling and checks the final URL against the same rules. A redirected request is therefore sent twice in browsers, and the target is checked after it is fetched rather than before. Under `redirectPolicy: "error"` the request is not repeated.

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

Validation runs in this order before the callback is sent: `paymentOption`, amount (`amountMsat` range or `unitAmount` unit/bounds), `receiveUnit`, `comment`, mandatory `payerData`, then `providerPolicy` on the callback URL.

| Option | Default | Notes |
| --- | --- | --- |
| `amountMsat` | — | Millisatoshis. Mutually exclusive with `unitAmount`; one is required. Checked against `minSendable`/`maxSendable` (or the selected option's bounds). |
| `unitAmount` | — | `{ amount, unit }` in the unit's smallest denomination. Requires the provider to return `paymentQuote`. |
| `receiveUnit` | — | Asks the provider to quote the receiver's unit. Requires `paymentQuote.receive`. |
| `paymentOption` | — | Advertised `paymentOptions` id. Omit for the default LUD-06 Lightning flow. |
| `comment` | — | LUD-12. Rejected if `commentAllowed` is absent or `0`, or if the comment is longer than `commentAllowed`. |
| `payerData` | — | LUD-18. Sent as JSON. Unrequested fields are passed through. |
| `validateBolt11` | `true` | Decodes the invoice and checks amount, network, and expiry. Recovers the signer and checks it against the `n` tag when present. |
| `validateMetadataHash` | `false` | Also require the invoice description hash to equal `sha256(metadata)`. |
| `expectedNetwork` | — | `"bitcoin"` (`lnbc`), `"testnet"` (`lntb`), `"signet"` (`lntbs`), or `"regtest"` (`lnbcrt`). |
| `validateExpiry` | `true` | Reject expired invoices. |
| `now` | `Date.now()` | Clock override for expiry checks (`Date`, seconds, or a function). |
| `nodePubkeyPolicy` | `"warn"` | `"warn"`, `"enforce"`, or `"off"`. |
| `providerPolicy` | `"off"` | See [Network and provider controls](#network-and-provider-controls). |
| `fetch`, `headers`, `timeoutMs`, `signal`, `redirectPolicy`, `maxResponseBytes`, `allowOnion`, `allowPrivateNetwork` | — | Applied to both the resolve and callback requests. |

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
validateUnit(payRequest, unitCode, paymentOption, { amount });
parsePayRequestResponse(raw, context);
parseSuccessAction(raw, options);
decryptSuccessAction(action, preimage); // async, LUD-09 AES
isDestinationPayment(payment);
assertDestinationPayment(payment);
destinationMatchesRail(payment, rail);
assertDestinationRail(payment, rail);
serviceKeysUrl(domainOrUrl);
parseServiceKeysResponse(raw, context);
fetchServiceKeys(domainOrUrl, options);
LNURL_SERVICE_PATH; // "/.well-known/lnurl-service"
```

### Errors

Every error extends `LnAddressError` and carries a stable `code`:

| Class | `code` |
| --- | --- |
| `InvalidLightningAddressError` | `INVALID_LIGHTNING_ADDRESS` |
| `InvalidLnurlError` | `INVALID_LNURL` |
| `NetworkError` | `NETWORK_ERROR` |
| `InvalidPayRequestError` | `INVALID_PAY_REQUEST` |
| `AmountOutOfRangeError` | `AMOUNT_OUT_OF_RANGE` |
| `CommentNotAllowedError` | `COMMENT_NOT_ALLOWED` |
| `CommentTooLongError` | `COMMENT_TOO_LONG` |
| `MissingMandatoryPayerDataError` | `MISSING_MANDATORY_PAYER_DATA` (also exposes `missingFields`) |
| `InvalidCallbackResponseError` | `INVALID_CALLBACK_RESPONSE` |
| `InvalidPaymentOptionError` | `INVALID_PAYMENT_OPTION` |
| `InvalidRequestPaymentOptionsError` | `INVALID_REQUEST_PAYMENT_OPTIONS` |
| `NodePubkeyMismatchError` | `NODE_PUBKEY_MISMATCH` |
| `InvalidServiceKeysError` | `INVALID_SERVICE_KEYS` |
| `VerifyError` | `VERIFY_ERROR` |

## Types

The public API uses camelCase for function names and object fields.

```ts
import type {
  DomainServiceKey,
  DomainServiceKeys,
  PayRequest,
  PaymentInstruction,
  PaymentOption,
  PaymentQuote,
  PaymentUnit,
  RequestPaymentOptions,
  UnitAmount,
  VerifyResult,
} from "lnaddress";
```

`PaymentInstruction` is a discriminated union:

```ts
if (payment.type === "bolt11") {
  payment.pr;
} else {
  // Destination instructions carry a paymentDestination, a paymentUri, or both.
  payment.paymentDestination ?? payment.paymentUri;
}
```

## Compatibility

- Bun: primary package manager and test runner.
- Node.js: Node 18+ through native `fetch` (CI runs a smoke test on 18, 20, 22, and 24).
- Browsers and edge runtimes: only standard Web APIs (`fetch`, `URL`, Web Crypto, `TextEncoder`, streams). No `Buffer`, `process`, or other Node polyfills are needed. The playground (`examples/playground`) builds with a plain Vite config.
- Package output: ESM-first with CJS compatibility through `exports.require`.

## Security Notes

- `metadataHash` is computed from the exact metadata string returned by the provider.
- `validateBolt11` is enabled by default. It checks the bech32 checksum, the network prefix, the amount, and expiry, and requires a payment hash. The signature is verified against the `n` payee node id when present; otherwise the payee is recovered from it. Invoice decoding is built in and checked against the BOLT11 specification's test vectors.
- BOLT11 description-hash validation is opt-in with `validateMetadataHash: true` because current LUD-06 behavior no longer requires it by default.
- If a provider returns `paymentQuote`, display requested amount, payment amount, receiver amount, fees, and expiry before payment.
- If a provider advertises `nodePubkeys`, BOLT11 payments include `nodePubkeyVerification` so wallets can show invoice-origin warnings. Mismatches are non-blocking by default (`nodePubkeyPolicy: "warn"`) and can be made strict with `"enforce"`.
- Domain service-key discovery validates flat `signingKeys` / `encryptionKeys` documents from `/.well-known/lnurl-service`; optional `certChain` metadata is preserved but not trusted beyond caller policy.
- LUD-09 AES success actions can be decrypted with `await action.decrypt(preimage)` or `decryptSuccessAction(action, preimage)`.
- LUD-09 URL success actions and destination `paymentUri` values are untrusted provider data; do not fetch/open them without app-level policy.
- Use `verifyPayment` when the provider supplies a verify URL. A returned preimage is checked against the invoice payment hash (`preimageVerified: true`), which proves payment. `settled: true` without a preimage is still only the provider's claim.

See [SECURITY.md](./SECURITY.md) for the full security model.

## Known limitations

- Private-network checks inspect hostnames and IP literals only. A public hostname that resolves to a private address is not detected. Use a custom `fetch` with DNS controls on servers.
- In browsers, redirect targets are checked after the browser has followed them (see [Network and provider controls](#network-and-provider-controls)).
- `providerPolicy: "same-site"` means same hostname or subdomain, not public-suffix-aware eTLD+1.

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

CI (`.github/workflows/ci.yml`) runs `bun run check` and an `npm publish --dry-run` on every PR and push to `main`, plus a Node 18/20/22/24 smoke test of the built package.

## Release Instructions

Prerequisite: the npm package must be configured for [trusted publishing](https://docs.npmjs.com/trusted-publishers) from this repository's `release.yml` workflow.

1. Move the `Unreleased` entries in `CHANGELOG.md` under the new version heading.
2. Bump `version` in `package.json` with semver. The tag must match it.
3. Commit, then create and push a tag like `v0.1.0`.
4. `.github/workflows/release.yml` runs `bun run check` and publishes with npm provenance.

Dry run locally:

```sh
bun run release:dry
```
