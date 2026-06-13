import { getMetadataHash } from "../../src";
import { test_bolt11_invoice } from "./bolt11";

type ServerState = {
  liquid_settled: boolean;
  bolt12_settled: boolean;
};

const alice_metadata = '[["text/plain","Alice test payment"]]';

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

export function start_lnurl_test_server() {
  const state: ServerState = {
    liquid_settled: false,
    bolt12_settled: false,
  };

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const origin = `http://${url.host}`;

      if (url.pathname === "/.well-known/lnurlp/alice") {
        return json({
          tag: "payRequest",
          callback: `${origin}/callback/bolt11`,
          minSendable: 1000,
          maxSendable: 100_000,
          metadata: alice_metadata,
          commentAllowed: 20,
        });
      }

      if (url.pathname === "/.well-known/lnurlp/liquid") {
        return json({
          tag: "payRequest",
          callback: `${origin}/callback/liquid`,
          minSendable: 1000,
          maxSendable: 100_000,
          metadata: '[["text/plain","Liquid test payment"]]',
        });
      }

      if (url.pathname === "/.well-known/lnurlp/bolt12") {
        return json({
          tag: "payRequest",
          callback: `${origin}/callback/bolt12`,
          minSendable: 1000,
          maxSendable: 100_000,
          metadata: '[["text/plain","BOLT12 test payment"]]',
        });
      }

      if (url.pathname === "/callback/bolt11") {
        if (url.searchParams.get("amount") !== "2500") {
          return json({ status: "ERROR", reason: "wrong amount" });
        }

        return json({
          status: "OK",
          pr: await test_bolt11_invoice(2500, getMetadataHash(alice_metadata)),
          routes: [],
          verify: `${origin}/verify/bolt11`,
        });
      }

      if (url.pathname === "/callback/liquid") {
        return json({
          status: "OK",
          paymentDestination: "liquid-address",
          paymentURI: "liquidnetwork:liquid-address",
          verify: `${origin}/verify/liquid`,
        });
      }

      if (url.pathname === "/callback/bolt12") {
        return json({
          status: "OK",
          paymentDestination: "lno1pg257enxv4ezqcneypekxarpw3jxj",
          paymentURI: "lightning:lno1pg257enxv4ezqcneypekxarpw3jxj",
          verify: `${origin}/verify/bolt12`,
        });
      }

      if (url.pathname === "/verify/bolt11") {
        return json({ status: "OK", settled: true, preimage: "00".repeat(32) });
      }

      if (url.pathname === "/verify/liquid") {
        const settled = state.liquid_settled;
        state.liquid_settled = true;
        return json({
          status: "OK",
          settled,
          paymentDestination: "liquid-address",
          paymentReference: settled ? "liquid-txid" : null,
        });
      }

      if (url.pathname === "/verify/bolt12") {
        const settled = state.bolt12_settled;
        state.bolt12_settled = true;
        return json({
          status: "OK",
          settled,
          paymentDestination: "lno1pg257enxv4ezqcneypekxarpw3jxj",
          paymentReference: settled ? "bolt12-payment-hash" : null,
        });
      }

      return json({ status: "ERROR", reason: "not found" }, { status: 404 });
    },
  });

  return {
    origin: `http://${server.hostname}:${server.port}`,
    stop: () => server.stop(true),
  };
}
