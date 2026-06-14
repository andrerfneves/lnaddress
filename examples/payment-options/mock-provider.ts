/**
 * Mock Payment Options Provider
 *
 * A runnable mock server that demonstrates the full paymentOptions flow.
 * Run with: `bun mock-provider.ts`
 *
 * Endpoints:
 *   GET /.well-known/lnurlp/alice   → LUD-06 payRequest + paymentOptions
 *   GET /callback                    → Returns paymentDestination per selected option
 *   GET /verify/:id                → LUD-21 verify with paymentOption + paymentReference
 *
 * Usage from the library:
 *   const payRequest = await resolve("http://localhost:3000/.well-known/lnurlp/alice", { allowPrivateNetwork: true });
 *   const payment = await requestPayment(payRequest, {
 *     amountMsat: 25000,
 *     paymentOption: "liquid",
 *     allowPrivateNetwork: true,
 *   });
 *   const result = await verifyPayment(payment, { allowPrivateNetwork: true });
 */

import { requestPayment, resolve, verifyPayment } from "../../dist/index.js";

const PORT = 3000;

const aliceMetadata = '[["text/plain","Alice — multi-rail payment"]]';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const verifyStates = new Map<string, { settled: boolean; paymentReference: string | null }>();

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(request: Request) {
    const url = new URL(request.url);
    const origin = `http://${url.host}`;

    // 1. LUD-06 payRequest with paymentOptions
    if (url.pathname === "/.well-known/lnurlp/alice") {
      return json({
        tag: "payRequest",
        callback: `${origin}/callback`,
        minSendable: 1000,
        maxSendable: 100_000_000,
        metadata: aliceMetadata,
        commentAllowed: 50,
        payerData: {
          name: { mandatory: true },
          email: { mandatory: false },
        },
        paymentOptions: [
          { id: "lightning", type: "lightning", available: true },
          { id: "lightning-bolt12", type: "lightning-bolt12", available: true },
          { id: "onchain", type: "onchain", available: true },
          { id: "liquid", type: "liquid", available: true },
          { id: "arkade", type: "arkade", available: false },
          { id: "spark", type: "spark", available: true },
        ],
      });
    }

    // 2. Callback — returns paymentDestination per selected option
    if (url.pathname === "/callback") {
      const amount = url.searchParams.get("amount");
      const paymentOption = url.searchParams.get("paymentOption");
      const comment = url.searchParams.get("comment");
      const payerData = url.searchParams.get("payerdata");

      if (!amount || !paymentOption) {
        return json({ status: "ERROR", reason: "Missing amount or paymentOption" }, 400);
      }

      const verifyId = crypto.randomUUID();
      const verifyUrl = `${origin}/verify/${verifyId}`;
      verifyStates.set(verifyId, { settled: false, paymentReference: null });

      // Simulate async settlement after 3 seconds
      setTimeout(() => {
        const state = verifyStates.get(verifyId);
        if (state) {
          state.settled = true;
          state.paymentReference = `${paymentOption}-ref-${verifyId.slice(0, 8)}`;
        }
      }, 3000);

      switch (paymentOption) {
        case "lightning":
          return json({
            status: "OK",
            paymentOption: "lightning",
            pr: "lnbc100n1p3qgxcqpp5...",
            paymentDestination: "lnbc100n1p3qgxcqpp5...",
            paymentURI: "lightning:lnbc100n1p3qgxcqpp5...",
            verify: verifyUrl,
          });

        case "lightning-bolt12":
          return json({
            status: "OK",
            paymentOption: "lightning-bolt12",
            paymentDestination: "lno1pg257enxv4ezqcneypekxarpw3jxj",
            paymentURI: "lightning:lno1pg257enxv4ezqcneypekxarpw3jxj",
            verify: verifyUrl,
          });

        case "onchain":
          return json({
            status: "OK",
            paymentOption: "onchain",
            paymentDestination: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
            paymentURI: "bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.001",
            verify: verifyUrl,
          });

        case "liquid":
          return json({
            status: "OK",
            paymentOption: "liquid",
            paymentDestination:
              "lq1qq2x6tjgk6r2v6jlj3mq5x3t2q6f0m4p3k7x9a4c5d6e7f8g9h0i1j2k3l4m5n6o7p8",
            paymentURI:
              "liquidnetwork:lq1qq2x6tjgk6r2v6jlj3mq5x3t2q6f0m4p3k7x9a4c5d6e7f8g9h0i1j2k3l4m5n6o7p8?amount=0.001",
            verify: verifyUrl,
          });

        case "spark":
          return json({
            status: "OK",
            paymentOption: "spark",
            paymentDestination: "spark-payment-destination-abc123",
            verify: verifyUrl,
          });

        default:
          return json({ status: "ERROR", reason: "Unsupported paymentOption" }, 400);
      }
    }

    // 3. LUD-21 verify — returns paymentOption + paymentReference
    if (url.pathname.startsWith("/verify/")) {
      const id = url.pathname.split("/verify/")[1];
      const state = verifyStates.get(id);

      if (!state) {
        return json({ status: "ERROR", reason: "Unknown verify ID" }, 404);
      }

      return json({
        status: "OK",
        settled: state.settled,
        paymentOption: "liquid", // would be stored per-session in a real provider
        paymentDestination:
          "lq1qq2x6tjgk6r2v6jlj3mq5x3t2q6f0m4p3k7x9a4c5d6e7f8g9h0i1j2k3l4m5n6o7p8",
        paymentReference: state.paymentReference,
      });
    }

    return json({ status: "ERROR", reason: "Not found" }, 404);
  },
});

const origin = `http://localhost:${PORT}`;

console.log(`
  🚀 Mock Payment Options Provider running at ${origin}

  Endpoints:
    GET ${origin}/.well-known/lnurlp/alice
    GET ${origin}/callback?amount=<msat>&paymentOption=<id>
    GET ${origin}/verify/<id>

  Available options: lightning, lightning-bolt12, onchain, liquid, spark
  (ark is advertised as unavailable)

  Run the client demo in 3 seconds...
`);

// Auto-run a client demo
setTimeout(async () => {
  console.log("\n  ─── Client Demo \u2500──\n");

  try {
    // 1. Resolve
    console.log(`  1. Resolve alice@localhost:${PORT}`);
    const payRequest = await resolve(`http://localhost:${PORT}/.well-known/lnurlp/alice`, {
      allowPrivateNetwork: true,
    });
    console.log(
      "     →",
      payRequest.paymentOptions?.map((o) => `${o.id}:${o.available ? "✓" : "✗"}`).join(", "),
    );

    // 2. Validate
    console.log("\n  2. Validate paymentOption: liquid");
    // validatePaymentOption is available from the library but not imported here
    // The validation happens inside requestPayment

    // 3. Request payment
    console.log("\n  3. Request payment (liquid, 25000 msat)");
    const payment = await requestPayment(payRequest, {
      amountMsat: 25000,
      paymentOption: "liquid",
      payerData: { name: "Demo Wallet" },
      allowPrivateNetwork: true,
    });
    console.log("     → type:", payment.type);
    console.log("     → paymentOption:", payment.paymentOption);
    console.log("     → paymentDestination:", payment.paymentDestination);
    console.log("     → paymentURI:", payment.paymentUri);
    console.log("     → verifyUrl:", payment.verifyUrl);

    // 4. Verify immediately (not settled yet)
    console.log("\n  4. Verify immediately...");
    const early = await verifyPayment(payment, { allowPrivateNetwork: true });
    console.log("     → settled:", early.settled);
    console.log("     → paymentReference:", early.paymentReference);

    // 5. Wait and verify again
    console.log("\n  5. Wait 3.5s for settlement...");
    await new Promise((r) => setTimeout(r, 3500));
    const later = await verifyPayment(payment, { allowPrivateNetwork: true });
    console.log("     → settled:", later.settled);
    console.log("     → paymentOption:", later.paymentOption);
    console.log("     → paymentReference:", later.paymentReference);

    console.log("\n  ✅ Demo complete!\n");
  } catch (error) {
    console.error("\n  ❌ Demo failed:", error, "\n");
  }

  console.log("  Server still running. Ctrl+C to stop.\n");
}, 3000);
