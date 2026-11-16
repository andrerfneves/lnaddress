# Security Model

`lnaddress` is a Lightning Address-first LNURL-pay client. It validates provider
responses enough to make common wallet and application flows hard to misuse, but
it does not make remote providers trusted.

## What Is Validated

- Lightning Address syntax, DNS-style domains, and well-known URL construction.
- LNURL bech32 checksums, human-readable part, padding, and decoded HTTP(S) URL.
- LNURL-pay `payRequest` shape, callback URL protocol, amount bounds, metadata,
  comments, mandatory payer data, and optional provider identity policy.
- BOLT11 invoice checksum, network prefix (`lnbc`, `lntb`, `lntbs`, `lnbcrt`),
  amount, expected network, expiry, and presence of a payment hash. The
  signature is verified against the `n` payee node id when present, and the
  payee is recovered from it otherwise. If a payRequest advertises `nodePubkeys`, the invoice payee is
  compared with the advertised nodes and returned as non-blocking verification
  metadata by default. Metadata description-hash validation is available as an
  opt-in strict mode with `validateMetadataHash: true`.
- Callback `verify` URLs as HTTP(S) URLs, with optional provider identity policy.
- Domain service-key documents from `/.well-known/lnurl-service`: flat `signingKeys` / `encryptionKeys`, exact optional domain binding, valid compressed secp256k1 public keys, duplicate key-id rejection within each key-use array, key-level `expiresAt`, and optional PEM-shaped `certChain` arrays.
- LUD-09 `successAction` message, URL, and AES shapes. URL actions must use
  HTTP(S), and AES actions can be decrypted with `decryptSuccessAction`.
- LUD-21 verification responses. When verifying a BOLT11 instruction, an echoed
  `pr` must match the requested invoice, and a returned `preimage` must hash to
  the invoice payment hash (`preimageVerified: true`). `settled: true` without a
  preimage remains a provider claim.
- Destination payment responses as typed destination instructions, with optional
  helper validation for known URI rails. Destination strings and URIs remain
  untrusted provider data until app-level rail validation succeeds.

## What Is Not Validated

- Provider business logic, custody state, inventory, or settlement truth beyond
  what the provider reports.
- TLS certificate pinning or DNSSEC.
- Certificate-chain trust decisions for service-key `certChain`; the library preserves and lightly validates PEM-shaped strings, but callers must apply any certificate policy they require.
- Whether a destination payment address belongs to the intended recipient.
- Whether a flexible destination rail is globally valid beyond helper-level URI
  scheme checks.
- Public-suffix/eTLD+1 browser-style same-site semantics; `providerPolicy:
  "same-site"` means same hostname or subdomain.
- Whether payer data values are semantically correct beyond mandatory presence.

## SSRF And Network Access

This library uses `fetch` on URLs derived from user input or provider responses.
Server-side applications should treat that as SSRF-relevant. Use a custom
`fetch` when your runtime needs network allowlists, proxying, DNS controls, IP
range blocking, or redirect limits.

Built-in controls:

- `timeoutMs` aborts resolve, callback, verify, and service-key requests that
  have not fully arrived, headers and body, in time.
- `signal` lets callers cancel in-flight requests, including body reads.
- `maxResponseBytes` (default 1 MiB) bounds response body size.
- Redirects are followed by the library, not by `fetch`. Under every
  `redirectPolicy`, including the default `"follow"`, each redirect target is run
  through the onion/private-network checks below before it is requested.
  `redirectPolicy` can additionally reject all redirects, cross-origin
  redirects, or HTTPS to HTTP downgrades. `Authorization`, `Proxy-Authorization`,
  and `Cookie` headers are dropped on cross-origin hops.
- Browsers hide redirect targets from manual redirect handling. There the
  library repeats the request with native redirects and checks the final URL
  afterwards, so the browser itself (CORS, mixed-content and private-network
  rules) is what prevents the intermediate request.
- `providerPolicy` can restrict callback and verify URLs to the same origin or
  same hostname/subdomain as the resolved provider.
- `.onion`, localhost, loopback, link-local, and private-network HTTP(S) URLs are
  rejected unless callers opt in with `allowOnion` or `allowPrivateNetwork`.
  These checks inspect the URL hostname only; DNS names that resolve to private
  addresses are not detected.

## Onion And Private Network Support

HTTP(S) `.onion` URLs require `allowOnion: true`. Localhost, loopback,
link-local, and private-network URLs require `allowPrivateNetwork: true`. These
options are useful for Tor-aware wallets, local demos, tests, and private
infrastructure, but server-side applications should still use custom DNS/IP
controls when processing untrusted user input.

## Custom Fetch Responsibilities

Injected `fetch` implementations should preserve standard `Response` behavior
where possible, especially `ok`, `status`, `statusText`, `url`, `redirected`, and
`json()`. If you enforce redirects inside custom fetch, document how that
interacts with `redirectPolicy`.

## Domain Service Keys

`fetchServiceKeys("example.com")` requests `https://example.com/.well-known/lnurl-service` and parses the returned domain service-key document. The optional `domain` field must match the source host when present; no wildcard or subdomain inheritance is assumed.

`certChain` is optional per-key metadata. The base trust model is the HTTPS origin plus the raw compressed secp256k1 `publicKey`; applications that require certificate-based trust must validate `certChain` according to their own policy before relying on it.

This feature only discovers keys. It does not define or validate signed-message envelopes, encrypted-provider-data envelopes, or compliance payloads; those belong to companion LUDs.

## nodePubkeys Invoice-Origin Checks

When a payRequest includes `nodePubkeys`, `lnaddress` compares the BOLT11 invoice payee node id against the advertised compressed secp256k1 pubkeys. If the BOLT11 `n` field is absent, the library recovers the signer pubkey from the invoice signature and uses that value.

The default `nodePubkeyPolicy: "warn"` follows the proposal's wallet UX: mismatches return `payment.nodePubkeyVerification.status === "mismatch"` with a warning string, but payment is not blocked. Use `nodePubkeyPolicy: "enforce"` only for strict policy callers that intentionally want `NodePubkeyMismatchError` on mismatch; use `"off"` to skip this comparison while keeping the other BOLT11 validation checks.

## BOLT11 Notes

`validateBolt11` is enabled by default. It verifies invoice structure, amount,
network policy, expiry, and the payment hash. The signature is checked against
the `n` payee node id when present (the payee is recovered from it otherwise),
and the optional `nodePubkeys` invoice-origin comparison runs. Decoding is
implemented in `src/lightning/bolt11.ts` on `@noble/secp256k1` and `js-sha256`,
and tested against the BOLT11 specification's vectors. Metadata description-hash validation is
opt-in with `validateMetadataHash: true`. These checks do not establish that the
provider is honest or that the invoice will settle. Always
use `verifyPayment` when the provider supplies a verify URL.

## Reporting Vulnerabilities

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/andrerfneves/lnaddress/security/advisories/new)
for this repository instead of opening public issues with exploit details.
