# Payment Options — LUD-XX multi-rail flow

This standalone explainer demonstrates the draft `paymentOptions` LUD-XX extension. It shows how a single LNURL-pay endpoint can advertise and route payments across multiple Bitcoin rails — Lightning, BOLT12, onchain, Liquid, Ark, Spark — without requiring separate discovery endpoints or breaking existing wallets.

## Files

- **`index.html`** — Self-contained visual explainer. Open it in a browser. No build step. Shows the flow, the JSON, the code, and the "why this matters" narrative.
- **`mock-provider.ts`** — A runnable mock provider that demonstrates the full server-side flow. Run with `bun`.

## Run the mock provider

```sh
bun mock-provider.ts
# Or point the HTML explainer at it
```

## The core idea

Today, if a service wants to accept Bitcoin over multiple rails, it needs:

- One endpoint for Lightning / BOLT11
- Another endpoint for BOLT12
- Another for onchain addresses
- Another for Liquid
- ...

With `paymentOptions`, a **single** `alice@example.com` Lightning Address resolves to one payRequest that says:

> "I can take your payment via Lightning, BOLT12, onchain, or Liquid. Pick one."

Legacy wallets that don't understand `paymentOptions` ignore it and get the default Lightning flow. Modern wallets can choose the best rail for the user's context.

## The flow

```
1. Resolve alice@example.com
   → GET /.well-known/lnurlp/alice
   ← { tag: "payRequest", paymentOptions: [...], ... }

2. User selects "liquid"
   → validatePaymentOption(payRequest, "liquid")

3. Request payment
   → GET /callback?amount=25000&paymentOption=liquid
   ← { status: "OK", paymentDestination: "lq1...", paymentURI: "liquidnetwork:..." }

4. Verify (optional)
   → GET /verify
   ← { status: "OK", settled: true, paymentOption: "liquid", paymentReference: "txid" }
```

## Why this is transformational

| Before | After |
|--------|-------|
| Multiple endpoints, one per rail | One endpoint, one flow |
| Wallet needs to know rail before resolving | Wallet discovers rails at resolve time |
| No unified verification | LUD-21 verify works for all rails |
| Each rail has its own UX | Same UX, different destination |

The LNURL-pay protocol becomes the **universal router** for Bitcoin payments.

## Composing with LUD-22 currencies

A provider can attach `currencies` at the top level or inside each `paymentOptions[]` entry. Option-specific currencies override the top-level list for that rail; otherwise the option inherits the top-level LUD-22 currencies. Wallets can then combine `paymentOption=<id>` with `amount=<units>.<code>` and/or `convert=<code>` on the same callback.
