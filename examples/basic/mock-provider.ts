type ProviderState = {
  bolt11_settled: boolean;
  liquid_settled: boolean;
};

const origin = "https://lnaddress.test";

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

export function create_mock_lnurl_fetch(): typeof fetch {
  const state: ProviderState = {
    bolt11_settled: false,
    liquid_settled: false,
  };

  return async (input) => {
    const url = new URL(String(input));

    if (url.origin !== origin) {
      return json({ status: "ERROR", reason: "unknown host" }, { status: 404 });
    }

    if (url.pathname === "/.well-known/lnurlp/alice") {
      return json({
        tag: "payRequest",
        callback: `${origin}/callback/bolt11`,
        minSendable: 1_000,
        maxSendable: 100_000,
        metadata: '[["text/plain","Alice test wallet"],["text/identifier","alice@lnaddress.test"]]',
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
        callback: `${origin}/callback/liquid`,
        minSendable: 5_000,
        maxSendable: 250_000,
        metadata: '[["text/plain","Liquid settlement demo"]]',
      });
    }

    if (url.pathname === "/callback/bolt11") {
      return json({
        status: "OK",
        pr: "lnbc1qqqqqqqqqqqqqq",
        routes: [],
        verify: `${origin}/verify/bolt11`,
        successAction: {
          tag: "message",
          message: `Queued ${url.searchParams.get("amount")} msat`,
        },
      });
    }

    if (url.pathname === "/callback/liquid") {
      return json({
        status: "OK",
        paymentDestination: "liquid-address-for-demo",
        paymentURI: "liquidnetwork:liquid-address-for-demo",
        verify: `${origin}/verify/liquid`,
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
        paymentDestination: "liquid-address-for-demo",
        paymentReference: settled ? "liquid-demo-txid" : null,
      });
    }

    return json({ status: "ERROR", reason: "not found" }, { status: 404 });
  };
}

export const alice = "alice@lnaddress.test";
export const liquid = "liquid@lnaddress.test";
