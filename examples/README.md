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
```

## Playground

`examples/playground` is a Vite React app with shadcn-style local components and mocked provider flows.

```sh
cd examples/playground
bun install
bun run dev
```

The playground imports `lnaddress` from the local package through `file:../..`.
