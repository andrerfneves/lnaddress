# Changelog

## Unreleased

- Removed legacy LUD-22 / PR #251 currency conversion support (`currencies`, `denominatedAmount`, `convert`, and `converted`) ahead of the replacement `paymentQuote` unit/quote layer.
- Updated draft `paymentOptions` v2 support: generic `bolt12`/`bark` method naming, URI-only non-`pr` callback responses, `paymentURI` in verify responses, stricter `type: "lightning"` `pr` requirement, and expanded destination rail helpers.
- Added draft Domain Service Keys LUD-XX support for `/.well-known/lnurl-service` URL construction, parsing, fetching, validation, optional per-key `certChain`, docs, and examples.
- Added draft LUD-XX `nodePubkeys` support for payRequest parsing, BOLT11 invoice-origin verification metadata, non-blocking mismatch warnings, and opt-in strict enforcement.
- Added nodePubkeys tests, docs, and a runnable local example.

## 0.1.0

- Initial Lightning Address-first LNURL-pay client.
- Added LUD-06, LUD-09, LUD-12, LUD-16, LUD-18, and LUD-21 support.
- Added snake_case public API, typed errors, metadata hashing, LNURL bech32 utilities, mocked-fetch tests, and local-server e2e coverage.
- Added basic examples, a mocked React playground, example compilation checks, package import smoke tests, and extra edge-case coverage.
