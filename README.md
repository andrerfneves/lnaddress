# lnaddress

Lightning Address-first TypeScript client for LNURL-pay.

`lnaddress` makes the common Lightning Address flow tiny while keeping the typed primitives wallets, apps, and servers need for advanced LNURL-pay work.

```sh
bun i lnaddress
```

```ts
import { pay } from "lnaddress";

const payment = await pay("alice@example.com", {
  amount_msat: 10_000,
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

`lnaddress` intentionally does not implement withdraw, auth, hosted channels, channel requests, NWC, UMA compliance, encrypted provider data, or keysend in v0.1.0.

## Quickstart: request a BOLT11 invoice

```ts
import { pay } from "lnaddress";

const payment = await pay("alice@example.com", {
  amount_msat: 25_000,
});

if (payment.type !== "bolt11") {
  throw new Error("Expected a BOLT11 invoice");
}

console.log(payment.pr);
```

## Resolve first, pay later

```ts
import { request_payment, resolve } from "lnaddress";

const pay_request = await resolve("alice@example.com");

console.log(pay_request.description);
console.log(pay_request.min_sendable_msat);
console.log(pay_request.max_sendable_msat);

const payment = await request_payment(pay_request, {
  amount_msat: 50_000n,
});
```

## Lightning Address examples

```ts
import { is_lightning_address, parse_lightning_address, resolve } from "lnaddress";

is_lightning_address("alice@example.com"); // true

const address = parse_lightning_address("alice+shop@EXAMPLE.COM");
// { username: "alice+shop", domain: "example.com", address: "alice+shop@example.com" }

await resolve("alice@example.com");
// GET https://example.com/.well-known/lnurlp/alice
```

## LNURL examples

```ts
import { decode_lnurl, encode_lnurl, resolve } from "lnaddress";

const encoded = encode_lnurl("https://example.com/.well-known/lnurlp/alice");
const url = decode_lnurl(encoded);

await resolve(encoded);
await resolve("lnurlp://example.com/alice");
await resolve(url);
```

## Comments

```ts
import { request_payment, resolve, validate_comment } from "lnaddress";

const pay_request = await resolve("alice@example.com");

validate_comment(pay_request, "thanks");

await request_payment(pay_request, {
  amount_msat: 10_000,
  comment: "thanks",
});
```

If the provider does not advertise `commentAllowed`, comments are rejected before the callback request is sent.

## Payer Data

```ts
import { request_payment, resolve, validate_mandatory_payer_data } from "lnaddress";

const pay_request = await resolve("merchant@example.com");

validate_mandatory_payer_data(pay_request, {
  name: "Alice",
  email: "alice@example.com",
});

await request_payment(pay_request, {
  amount_msat: 100_000,
  payer_data: {
    name: "Alice",
    email: "alice@example.com",
  },
});
```

`payer_data` is passed through as provided. Fields that were not requested by the provider are not stripped.

## Verify

```ts
import { pay, verify_payment } from "lnaddress";

const payment = await pay("alice@example.com", {
  amount_msat: 10_000,
});

const result = await verify_payment(payment);

if (result.status === "OK" && result.settled) {
  console.log(result.preimage);
}
```

You can also verify by URL:

```ts
import { verify_payment } from "lnaddress";

await verify_payment("https://example.com/verify?k1=...");
```

## Destination Instructions

Some providers return payment destinations instead of BOLT11 invoices. `lnaddress` preserves those responses as a typed destination instruction.

```ts
const payment = await pay("liquid@example.com", {
  amount_msat: 25_000,
});

if (payment.type === "destination") {
  console.log(payment.payment_destination);
  console.log(payment.payment_uri);
  console.log(payment.verify_url);
}
```

The same shape works for BOLT12-style offers and destination rails such as onchain, Liquid, Ark, or Spark when a provider returns `paymentDestination`, `paymentURI`, and optionally `verify`.

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

const pay_request = await resolve("alice@example.com", {
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
  await pay("alice@example.com", { amount_msat: 1 });
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
const pay_request = await resolve("alice@example.com", {
  fetch,
});
```

### `request_payment(pay_request_or_input, options)`

Accepts a resolved `PayRequest` or any `resolve` input and returns a `PaymentInstruction`.

```ts
const payment = await request_payment("alice@example.com", {
  amount_msat: 10_000,
  comment: "hi",
  payer_data: { name: "Alice" },
  validate_bolt11: true,
});
```

### `pay(input, options)`

One-shot `resolve` plus `request_payment`.

### `verify_payment(payment_or_verify_url, options?)`

Fetches a LUD-21 verify URL and returns a `VerifyResult`.

### Utilities

```ts
parse_lightning_address(address);
is_lightning_address(value);
decode_lnurl(lnurl);
encode_lnurl(url);
parse_metadata(metadata_string);
get_metadata_hash(metadata_string);
validate_callback_amount(pay_request, amount_msat);
validate_comment(pay_request, comment);
validate_mandatory_payer_data(pay_request, payer_data);
```

## Types

The public API uses snake_case for function names and object fields.

```ts
import type { PayRequest, PaymentInstruction, VerifyResult } from "lnaddress";
```

`PaymentInstruction` is a discriminated union:

```ts
if (payment.type === "bolt11") {
  payment.pr;
} else {
  payment.payment_destination;
}
```

## Compatibility

- Bun: primary package manager and test runner.
- Node.js: Node 18+ through native `fetch`.
- Browsers and edge runtimes: no Node-only APIs in core code.
- Package output: ESM-first with CJS compatibility through `exports.require`.

## Security Notes

- `metadata_hash` is computed from the exact metadata string returned by the provider.
- `validate_bolt11` performs basic invoice shape validation only. It is not a full BOLT11 decoder.
- AES success actions are preserved, but synchronous AES decryption is not implemented in v0.1.0 because Web Crypto is asynchronous.
- Always verify settlement with `verify_payment` when the provider supplies a verify URL.

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
