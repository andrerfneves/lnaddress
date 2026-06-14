import type { FetchLike } from "lnaddress";

const playgroundBolt11Invoice =
  "lnbc250000p1p5ww7qqhp5s4rd659qkra3mncxwkamxxf0l2fnwe5w8qutznmmrh206n7uwdxqnp4qvdcf32k0vfxgsyet5ldt246q4jaw8scx3sysx0lnstlt6w4m5rc7xqxfvcqcqzxc0wgaxw65vk8770auuku3uyr6qxfyug5g5v3lswc8dtxjcda6vyx0h8vu0ffc9q02cppgcvv3h5zdvexpas0rgkh82uz6hjcc8v0spzpn66w";

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
        pr: playgroundBolt11Invoice,
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
        pr: playgroundBolt11Invoice,
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
