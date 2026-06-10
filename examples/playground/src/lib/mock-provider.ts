import type { FetchLike } from "lnaddress";

type ProviderState = {
  bolt11_settled: boolean;
  liquid_settled: boolean;
};

export const mock_origin = "https://playground.lnaddress.test";

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

export function create_playground_fetch(): FetchLike {
  const state: ProviderState = {
    bolt11_settled: false,
    liquid_settled: false,
  };

  return async (input) => {
    const url = new URL(String(input));

    if (url.origin !== mock_origin) {
      return json({ status: "ERROR", reason: "unknown host" }, { status: 404 });
    }

    if (url.pathname === "/.well-known/lnurlp/alice") {
      return json({
        tag: "payRequest",
        callback: `${mock_origin}/callback/bolt11`,
        minSendable: 1_000,
        maxSendable: 250_000,
        metadata:
          '[["text/plain","Alice playground wallet"],["text/identifier","alice@playground.lnaddress.test"]]',
        commentAllowed: 80,
        payerData: {
          name: { mandatory: true },
          email: { mandatory: false },
        },
      });
    }

    if (url.pathname === "/.well-known/lnurlp/liquid") {
      return json({
        tag: "payRequest",
        callback: `${mock_origin}/callback/liquid`,
        minSendable: 5_000,
        maxSendable: 500_000,
        metadata: '[["text/plain","Liquid destination playground"]]',
      });
    }

    if (url.pathname === "/callback/bolt11") {
      const amount = url.searchParams.get("amount");
      const payerdata = url.searchParams.get("payerdata");

      if (!payerdata) {
        return json({ status: "ERROR", reason: "payerdata required" });
      }

      return json({
        status: "OK",
        pr: "lnbc1qqqqqqqqqqqqqq",
        routes: [],
        verify: `${mock_origin}/verify/bolt11`,
        successAction: {
          tag: "message",
          message: `Created invoice for ${amount} msat`,
        },
      });
    }

    if (url.pathname === "/callback/liquid") {
      return json({
        status: "OK",
        paymentDestination: "liquid-address-for-playground",
        paymentURI: "liquidnetwork:liquid-address-for-playground",
        verify: `${mock_origin}/verify/liquid`,
      });
    }

    if (url.pathname === "/verify/bolt11") {
      const settled = state.bolt11_settled;
      state.bolt11_settled = true;
      return json({
        status: "OK",
        settled,
        preimage: settled ? "00".repeat(32) : null,
        pr: "lnbc1qqqqqqqqqqqqqq",
      });
    }

    if (url.pathname === "/verify/liquid") {
      const settled = state.liquid_settled;
      state.liquid_settled = true;
      return json({
        status: "OK",
        settled,
        paymentDestination: "liquid-address-for-playground",
        paymentReference: settled ? "liquid-playground-txid" : null,
      });
    }

    return json({ status: "ERROR", reason: "not found" }, { status: 404 });
  };
}
