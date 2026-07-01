# Payment Options + PaymentQuote — LUD-XX multi-rail flow

This standalone explainer demonstrates the draft `paymentOptions` LUD-XX extension composed with the draft `paymentQuote` LUD-XX extension. A single LNURL-pay endpoint can advertise multiple Bitcoin rails, expose supported units, quote the selected payment flow, and keep LUD-21 verification unified.

## Files

- **`index.html`** — Self-contained visual explainer. Open it in a browser. No build step.
- **`mock-provider.ts`** — Runnable mock provider demonstrating `paymentOptions`, `units`, `unit`, `receiveUnit`, and `paymentQuote`.

## Run the mock provider

```sh
bun mock-provider.ts
```

## The core idea

With `paymentOptions`, a single `alice@example.com` Lightning Address resolves to one payRequest that says:

> "I can take your payment via Lightning, BOLT12, onchain, Liquid USDT, Spark, or Bark. Pick one."

With `paymentQuote`, that same payRequest can also say:

> "I accept USD input, this Liquid USDT rail will require X USDT, the receiver gets Y USDT, and fees are Z."

Legacy wallets ignore unknown fields and can still use the default Lightning flow. Modern wallets can choose the rail and show the quote before the user confirms.

## The flow

```txt
1. Resolve alice@example.com
   → GET /.well-known/lnurlp/alice
   ← { tag: "payRequest", units: [...], paymentOptions: [...] }

2. User selects "liquid-usdt" and enters 100.00 USD
   → validatePaymentOption(payRequest, "liquid-usdt")
   → validateUnit(payRequest, "USD", "liquid-usdt", { amount: 10000 })

3. Request payment
   → GET /callback?amount=10000&unit=USD&receiveUnit=USDT&paymentOption=liquid-usdt
   ← { status: "OK", paymentURI: "liquidnetwork:...", paymentQuote: {...} }

4. Verify (optional)
   → GET /verify
   ← { status: "OK", settled: true, paymentOption: "liquid-usdt", paymentReference: "txid", paymentQuote: {...} }
```

## Why this is useful

| Before | After |
|--------|-------|
| Multiple endpoints, one per rail | One endpoint, one flow |
| Wallet needs to know rail before resolving | Wallet discovers rails at resolve time |
| Quotes tied to one legacy shape | Generic `units` + `paymentQuote` compose with any rail |
| No unified verification | LUD-21 verify works for all rails |

The LNURL-pay protocol becomes a universal router while keeping method selection (`paymentOptions`) separate from economic quoting (`paymentQuote`).
