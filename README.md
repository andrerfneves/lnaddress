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
- Small API surface: resolve, request, pay, verify.
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

Providers may advertise multiple payment rails via `paymentOptions` in the LUD-06 response. `lnaddress` parses them and lets you select one before the callback.

```ts
import { requestPayment, resolve, validatePaymentOption } from "lnaddress";

const payRequest = await resolve("alice@example.com");

// See available options
console.log(payRequest.paymentOptions);
// [{ id: "lightning", type: "lightning" }, { id: "liquid", type: "liquid" }]

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

If `paymentOption` is absent, the normal LUD-06 Lightning flow is used. `validatePaymentOption` rejects unknown or unavailable options before the callback is sent.

## Destination Instructions

Some providers return payment destinations instead of BOLT11 invoices. `lnaddress` preserves those responses as a typed destination instruction.

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

The same shape works for BOLT12-style offers and destination rails such as onchain, Liquid, Arkade, or Spark when a provider returns `paymentDestination`, `paymentURI`, and optionally `verify`.

## Examples

This repository includes copy-pasteable examples and a richer mocked playground:

- `examples/basic`: small scripts for resolve, BOLT11 requests, comments, payer data, verify, and destination payments.
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
```

## Types

The public API uses camelCase for function names and object fields.

```ts
import type { PayRequest, PaymentInstruction, PaymentOption, VerifyResult } from "lnaddress";
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
- `validateBolt11` performs basic invoice shape validation only. It is not a full BOLT11 decoder.
- AES success actions are preserved, but synchronous AES decryption is not implemented in v0.1.0 because Web Crypto is asynchronous.
- Always verify settlement with `verifyPayment` when the provider supplies a verify URL.

## Roadmap

- Full BOLT11 invoice decoding and amount/hash checks.
- Async AES success action helper.
- More destination-rail examples as provider conventions stabilize.

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
