import type { FetchLike } from "lnaddress";

type ProviderState = {
  bolt11Settled: boolean;
  liquidSettled: boolean;
};

export const mockOrigin = "https://playground.lnaddress.test";

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

export function createPlaygroundFetch(): FetchLike {
  const state: ProviderState = {
    bolt11Settled: false,
    liquidSettled: false,
  };

  return async (input) => {
    const url = new URL(String(input));

    if (url.origin !== mockOrigin) {
      return json({ status: "ERROR", reason: "unknown host" }, { status: 404 });
    }

    if (url.pathname === "/.well-known/lnurlp/alice") {
      return json({
        tag: "payRequest",
        callback: `${mockOrigin}/callback/bolt11`,
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
        callback: `${mockOrigin}/callback/liquid`,
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
        verify: `${mockOrigin}/verify/bolt11`,
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
        verify: `${mockOrigin}/verify/liquid`,
      });
    }

    if (url.pathname === "/verify/bolt11") {
      const settled = state.bolt11Settled;
      state.bolt11Settled = true;
      return json({
        status: "OK",
        settled,
        preimage: settled ? "00".repeat(32) : null,
        pr: "lnbc1qqqqqqqqqqqqqq",
      });
    }

    if (url.pathname === "/verify/liquid") {
      const settled = state.liquidSettled;
      state.liquidSettled = true;
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

export const create_playground_fetch = createPlaygroundFetch;
