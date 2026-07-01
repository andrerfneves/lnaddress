/**
 * Mock Payment Options + PaymentQuote Provider
 *
 * Runnable demo of paymentOptions composed with paymentQuote units.
 * Run with: `bun mock-provider.ts`
 */

import { requestPayment, resolve, verifyPayment } from "../../dist/index.js";

const PORT = 3000;

const aliceMetadata = '[["text/plain","Alice — multi-rail payment"]]';
const usd = {
  code: "USD",
  name: "US Dollar",
  symbol: "$",
  decimals: 2,
  minAmount: "100",
  maxAmount: "100000",
};
const usdt = {
  code: "USDT",
  name: "Tether USD on Liquid",
  symbol: "₮",
  decimals: 6,
  assetId: "liquid-usdt-demo-asset",
};

type VerifyState = {
  settled: boolean;
  paymentOption: string;
  paymentDestination?: string;
  paymentUri?: string;
  paymentReference: string | null;
  paymentQuote?: ReturnType<typeof buildLiquidQuote>;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildLiquidQuote(amount: string, unit: string, receiveUnit = "USDT") {
  const requestedAmount = BigInt(amount);
  const receiveAmount = unit === "USD" ? requestedAmount * 10000n : requestedAmount;
  const feeAmount = 25000n;
  const paymentAmount = receiveAmount + feeAmount;

  return {
    id: `quote_${crypto.randomUUID()}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    requested: { amount, unit },
    payment: { amount: paymentAmount.toString(), unit: receiveUnit },
    receive: { amount: receiveAmount.toString(), unit: receiveUnit },
    fees: [
      { amount: feeAmount.toString(), unit: receiveUnit, description: "Liquid settlement fee" },
    ],
  };
}

const verifyStates = new Map<string, VerifyState>();

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(request: Request) {
    const url = new URL(request.url);
    const origin = `http://${url.host}`;

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
        units: [usd],
        paymentOptions: [
          { id: "lightning", type: "lightning", available: true },
          { id: "bolt12", type: "bolt12", available: true },
          { id: "onchain", type: "onchain", available: true },
          { id: "liquid-usdt", type: "liquid", available: true, units: [usd, usdt] },
          { id: "arkade", type: "arkade", available: false },
          { id: "spark", type: "spark", available: true },
          { id: "bark", type: "bark", available: true },
        ],
      });
    }

    if (url.pathname === "/callback") {
      const amount = url.searchParams.get("amount");
      const unit = url.searchParams.get("unit") ?? "msat";
      const receiveUnit = url.searchParams.get("receiveUnit") ?? undefined;
      const paymentOption = url.searchParams.get("paymentOption") ?? "lightning";

      if (!amount) {
        return json({ status: "ERROR", reason: "Missing amount" }, 400);
      }

      const verifyId = crypto.randomUUID();
      const verifyUrl = `${origin}/verify/${verifyId}`;

      function store(state: Omit<VerifyState, "settled" | "paymentReference">) {
        verifyStates.set(verifyId, { ...state, settled: false, paymentReference: null });
        setTimeout(() => {
          const current = verifyStates.get(verifyId);
          if (current) {
            current.settled = true;
            current.paymentReference = `${paymentOption}-ref-${verifyId.slice(0, 8)}`;
          }
        }, 3000);
      }

      switch (paymentOption) {
        case "lightning":
          store({ paymentOption: "lightning" });
          return json({
            status: "OK",
            paymentOption: "lightning",
            pr: "lnbc100n1p3qgxcqpp5...",
            paymentURI: "lightning:lnbc100n1p3qgxcqpp5...",
            verify: verifyUrl,
          });

        case "bolt12":
          store({
            paymentOption: "bolt12",
            paymentUri: "lightning:lno1pg257enxv4ezqcneypekxarpw3jxj",
          });
          return json({
            status: "OK",
            paymentOption: "bolt12",
            paymentURI: "lightning:lno1pg257enxv4ezqcneypekxarpw3jxj",
            verify: verifyUrl,
          });

        case "onchain":
          store({
            paymentOption: "onchain",
            paymentDestination: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
          });
          return json({
            status: "OK",
            paymentOption: "onchain",
            paymentDestination: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
            paymentURI: "bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.001",
            verify: verifyUrl,
          });

        case "liquid-usdt": {
          const paymentQuote = buildLiquidQuote(amount, unit, receiveUnit ?? "USDT");
          const paymentUri = `liquidnetwork:liquid-address-for-demo?assetid=${usdt.assetId}&amount=${paymentQuote.payment.amount}`;
          store({
            paymentOption: "liquid-usdt",
            paymentDestination: "liquid-address-for-demo",
            paymentUri,
            paymentQuote,
          });
          return json({
            status: "OK",
            paymentOption: "liquid-usdt",
            paymentDestination: "liquid-address-for-demo",
            paymentURI: paymentUri,
            paymentQuote,
            verify: verifyUrl,
          });
        }

        case "spark":
          store({ paymentOption: "spark", paymentDestination: "spark-payment-destination-abc123" });
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

    if (url.pathname.startsWith("/verify/")) {
      const id = url.pathname.split("/verify/")[1];
      const state = verifyStates.get(id);

      if (!state) {
        return json({ status: "ERROR", reason: "Unknown verify ID" }, 404);
      }

      return json({
        status: "OK",
        settled: state.settled,
        paymentOption: state.paymentOption,
        paymentDestination: state.paymentDestination,
        paymentURI: state.paymentUri,
        paymentReference: state.paymentReference,
        paymentQuote: state.paymentQuote,
      });
    }

    return json({ status: "ERROR", reason: "Not found" }, 404);
  },
});

const origin = `http://localhost:${PORT}`;

console.log(`
  🚀 Mock Payment Options + PaymentQuote Provider running at ${origin}

  Endpoints:
    GET ${origin}/.well-known/lnurlp/alice
    GET ${origin}/callback?amount=<integer>&unit=<unit>&receiveUnit=<unit>&paymentOption=<id>
    GET ${origin}/verify/<id>

  Available options: lightning, bolt12, onchain, liquid-usdt, spark, bark
  (arkade is advertised as unavailable)

  Run the client demo in 3 seconds...
`);

setTimeout(async () => {
  console.log("\n  ─── Client Demo ───\n");

  try {
    console.log(`  1. Resolve alice@localhost:${PORT}`);
    const payRequest = await resolve(`http://localhost:${PORT}/.well-known/lnurlp/alice`, {
      allowPrivateNetwork: true,
    });
    console.log(
      "     →",
      payRequest.paymentOptions
        ?.map((o) => `${o.id}:${o.available === false ? "✗" : "✓"}`)
        .join(", "),
    );
    console.log("     → units:", payRequest.units?.map((unit) => unit.code).join(", "));

    console.log("\n  2. Request payment (100.00 USD → receive USDT over Liquid)");
    const payment = await requestPayment(payRequest, {
      unitAmount: { amount: 10_000, unit: "USD" },
      receiveUnit: "USDT",
      paymentOption: "liquid-usdt",
      payerData: { name: "Demo Wallet" },
      allowPrivateNetwork: true,
    });
    console.log("     → type:", payment.type);
    console.log("     → paymentOption:", payment.paymentOption);
    console.log("     → paymentURI:", payment.paymentUri);
    console.log("     → quote:", payment.paymentQuote);

    console.log("\n  3. Verify immediately...");
    const early = await verifyPayment(payment, { allowPrivateNetwork: true });
    console.log("     → settled:", early.settled);
    console.log("     → paymentReference:", early.paymentReference);
    console.log("     → quote id:", early.paymentQuote?.id);

    console.log("\n  4. Wait 3.5s for settlement...");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3500));
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

void server;
