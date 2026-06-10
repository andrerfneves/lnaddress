# Security Model

`lnaddress` is a Lightning Address-first LNURL-pay client. It validates provider
responses enough to make common wallet and application flows hard to misuse, but
it does not make remote providers trusted.

## What Is Validated

- Lightning Address syntax, DNS-style domains, and well-known URL construction.
- LNURL bech32 checksums, human-readable part, padding, and decoded HTTP(S) URL.
- LNURL-pay `payRequest` shape, callback URL protocol, amount bounds, metadata,
  comments, mandatory payer data, and optional provider identity policy.
- BOLT11 invoice checksum, amount, metadata description hash, expected network,
  expiry, ECDSA signature recovery and verification, and payee node id matching
  when the invoice includes an `n` tag.
- Callback `verify` URLs as HTTP(S) URLs.
- LUD-09 `successAction` message, URL, and AES shapes. URL actions must use
  HTTP(S), and AES actions can be decrypted with `decrypt_success_action`.
- LUD-21 verification response shape.
- Destination payment responses as typed destination instructions, with optional
  helper validation for known URI rails.

## What Is Not Validated

- Provider business logic, custody state, inventory, or settlement truth beyond
  what the provider reports.
- TLS certificate pinning or DNSSEC.
- Whether a destination payment address belongs to the intended recipient.
- Whether a flexible destination rail is globally valid beyond helper-level URI
  scheme checks.
- Whether payer data values are semantically correct beyond mandatory presence.

## SSRF And Network Access

This library uses `fetch` on URLs derived from user input or provider responses.
Server-side applications should treat that as SSRF-relevant. Use a custom
`fetch` when your runtime needs network allowlists, proxying, DNS controls, IP
range blocking, or redirect limits.

Useful controls:

- `timeout_ms` aborts slow resolve, callback, and verify requests.
- `signal` lets callers cancel in-flight requests.
- `redirect_policy` can reject redirects, cross-origin redirects, or HTTPS to
  HTTP downgrades after fetch returns.
- `provider_policy` can restrict callback and verify URLs to the same origin or
  same site as the resolved provider.

## Onion Support

HTTP(S) `.onion` URLs are allowed. Runtimes that cannot or should not reach onion
services should block them in a custom `fetch` or network layer. The
`allow_onion` option remains accepted for backward compatibility, but onion URLs
are not blocked by default.

## Custom Fetch Responsibilities

Injected `fetch` implementations should preserve standard `Response` behavior
where possible, especially `ok`, `status`, `statusText`, `url`, `redirected`, and
`json()`. If you enforce redirects inside custom fetch, document how that
interacts with `redirect_policy`.

## BOLT11 Notes

`validate_bolt11` is enabled by default. It verifies invoice structure, amount,
metadata hash, network policy, expiry, signature, and `n` payee node id when
present. It does not establish that the provider is honest or that the invoice
will settle. Always use `verify_payment` when the provider supplies a verify URL.

## Reporting Vulnerabilities

Please report security issues privately through the repository owner instead of
opening public issues with exploit details.
