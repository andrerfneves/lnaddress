# Changelog

## Unreleased

- **Dependencies:** removed `bolt11`, reversing `109268f`. It pulled in `bitcoinjs-lib`, `bn.js`, `lodash`, `create-hash`, and a native `secp256k1`, shipping a second ECDSA and SHA-256 implementation and requiring `Buffer`/`process` polyfills in browsers. BOLT11 decoding is now built in on `@noble/secp256k1` and `js-sha256`, sharing one bech32 codec with LNURL, and is tested against the BOLT11 spec vectors. Runtime dependencies are now `js-sha256` and `zod`. `@noble/secp256k1` was already bundled into `dist` and moves to `devDependencies`.
- **BOLT11:** signet invoices (`lntbs`) now decode as `"signet"`. Simnet (`lnsb`), previously mislabeled as signet, is rejected. Invoices must carry a payment hash. Fixed-length fields (`p`, `h`, `s`, `n`) with the wrong length are skipped, as the spec requires. With an `n` field, the signature is verified against it rather than recovered.
- **Security (behavior change):** redirects are now always followed by the library, including under the default `redirectPolicy: "follow"`. Every hop is checked against the onion/private-network rules before it is requested. Previously the default policy let `fetch` follow redirects unchecked to private addresses. Credentials headers are dropped on cross-origin hops, only 301/302/303/307/308 count as redirects, and bodies of intermediate redirects are cancelled. In browsers (opaque redirects), the request is repeated natively and the final URL is checked.
- **Security:** `timeoutMs` and `signal` now cover reading the response body, not just headers. Added `maxResponseBytes` (default 1 MiB).
- **Security:** `verifyPayment` now rejects a preimage that doesn't hash to the invoice payment hash, and an echoed `pr` that isn't the requested invoice. Verified preimages set `preimageVerified: true`.
- **Breaking:** `SuccessAction` AES `decrypt(preimage)` now returns `Promise<string>` and works. It previously always threw.
- **Examples:** the `examples/basic` and playground mocks sign real invoices for the requested amount. `pay-bolt11`, `comments`, `payer-data`, and `verify` previously crashed under default validation. The playground no longer needs Node polyfills, resets stale state when the input changes, clears the previous payment before a new request, and ignores clicks while a request is in flight.
- **Tooling:** `bun run test:examples` now runs every `examples/basic` script. The packed-package test installs only the declared dependencies, runs under Node, and has a 60s timeout for cold `npm pack`. Removed the unused npm lockfiles (`package-lock.json`); Bun's `bun.lock` is the only lockfile.
- **Docs:** README options, error-code, and compatibility reference, and a corrected SECURITY.md.

- Added draft `paymentQuote` support with `units`, `unitAmount`, `receiveUnit`, parsed quote details, option-level unit overrides, BOLT11 quote amount validation, verify quote echoes, docs, and examples.
- Removed legacy LUD-22 / PR #251 currency conversion support (`currencies`, `denominatedAmount`, `convert`, and `converted`) ahead of the replacement `paymentQuote` unit/quote layer.
- Updated draft `paymentOptions` v2 support: generic `bolt12`/`bark` method naming, URI-only non-`pr` callback responses, `paymentURI` in verify responses, stricter `type: "lightning"` `pr` requirement, and expanded destination rail helpers.
- Added draft Domain Service Keys LUD-XX support for `/.well-known/lnurl-service` URL construction, parsing, fetching, validation, optional per-key `certChain`, docs, and examples.
- Added draft LUD-XX `nodePubkeys` support for payRequest parsing, BOLT11 invoice-origin verification metadata, non-blocking mismatch warnings, and opt-in strict enforcement.
- Added nodePubkeys tests, docs, and a runnable local example.

## 0.1.0

- Initial Lightning Address-first LNURL-pay client.
- Added LUD-06, LUD-09, LUD-12, LUD-16, LUD-18, and LUD-21 support.
- Added camelCase public API, typed errors, metadata hashing, LNURL bech32 utilities, mocked-fetch tests, and local-server e2e coverage.
- Added basic examples, a mocked React playground, example compilation checks, package import smoke tests, and extra edge-case coverage.
