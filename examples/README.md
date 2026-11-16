# Examples

The examples use a local mocked LNURL provider by default. They are meant to be safe to run, copy, and modify without touching real payment infrastructure.

## Basic scripts

```sh
bun examples/basic/resolve.ts
bun examples/basic/pay-bolt11.ts
bun examples/basic/comments.ts
bun examples/basic/payer-data.ts
bun examples/basic/verify.ts
bun examples/basic/destination.ts
bun examples/basic/node-pubkeys.ts
bun examples/basic/service-keys.ts
```

`mock-provider.ts` signs real BOLT11 invoices for the requested amount (with the test key in `test/fixtures/bolt11.ts`), so the scripts pass the library's default invoice validation. `bun run test:examples` from the repo root type-checks and runs every script.

## Payment options explainer

`examples/payment-options` contains a standalone HTML explainer plus a Bun mock provider for the multi-rail `paymentOptions` flow.

```sh
cd examples/payment-options
bun mock-provider.ts
```

## Playground

`examples/playground` is a Vite React app with shadcn-style local components and mocked provider flows.

```sh
cd examples/playground
bun install
bun run dev
```

The playground imports `lnaddress` from the local package through `file:../..`.
