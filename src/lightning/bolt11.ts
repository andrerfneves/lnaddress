import { decode as decodePaymentRequest } from "bolt11";
import { InvalidCallbackResponseError } from "../core/errors";
import type { Bolt11Network, PayRequest, RequestPaymentOptions } from "../core/types";
import type { Bolt11PayeeNodeInfo } from "../extensions/node-pubkeys";
import { amountToMsatString } from "../utils/internal";

type DecodedInvoice = {
  network: Bolt11Network;
  timestamp: number;
  expirySeconds: number;
  amountMsat?: bigint;
  descriptionHash?: string;
  payeeNodeId: string;
  payeeNodeIdSource: Bolt11PayeeNodeInfo["payeeNodeIdSource"];
};

const bolt11Networks: Record<string, Bolt11Network> = {
  bc: "bitcoin",
  tb: "testnet",
  bcrt: "regtest",
  sb: "signet",
};

function nowSeconds(now: RequestPaymentOptions["now"]): number {
  const value = typeof now === "function" ? now() : now;
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  if (typeof value === "number") {
    return Math.floor(value);
  }
  return Math.floor(Date.now() / 1000);
}

function parseNetwork(bech32: string | undefined): Bolt11Network {
  const network = bech32 ? bolt11Networks[bech32] : undefined;
  if (!network) {
    throw new InvalidCallbackResponseError("BOLT11 invoice network prefix is invalid");
  }
  return network;
}

function parseTimestamp(timestamp: number | undefined): number {
  if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new InvalidCallbackResponseError("BOLT11 invoice timestamp is invalid");
  }
  return timestamp;
}

function parseExpirySeconds(expirySeconds: unknown): number {
  if (expirySeconds === undefined) return 3600;
  if (
    typeof expirySeconds !== "number" ||
    !Number.isSafeInteger(expirySeconds) ||
    expirySeconds < 0
  ) {
    throw new InvalidCallbackResponseError("BOLT11 invoice expiry is invalid");
  }
  return expirySeconds;
}

function parseAmountMsat(millisatoshis: string | null | undefined): bigint | undefined {
  if (millisatoshis === undefined || millisatoshis === null) return undefined;
  if (!/^\d+$/.test(millisatoshis)) {
    throw new InvalidCallbackResponseError("BOLT11 invoice amount is invalid");
  }
  return BigInt(millisatoshis);
}

function parsePayeeNodeId(payeeNodeKey: string | undefined): string {
  if (!payeeNodeKey || !/^(02|03)[0-9a-f]{64}$/i.test(payeeNodeKey)) {
    throw new InvalidCallbackResponseError("BOLT11 invoice payee node id is invalid");
  }
  return payeeNodeKey.toLowerCase();
}

function parseDescriptionHash(hash: unknown): string | undefined {
  if (hash === undefined) return undefined;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash)) {
    throw new InvalidCallbackResponseError("BOLT11 invoice description hash is invalid");
  }
  return hash.toLowerCase();
}

function decodeBolt11(pr: string): DecodedInvoice {
  let decoded: ReturnType<typeof decodePaymentRequest>;
  try {
    decoded = decodePaymentRequest(pr.trim());
  } catch (cause) {
    throw new InvalidCallbackResponseError("BOLT11 invoice is invalid", {
      cause,
    });
  }

  const tags = decoded.tagsObject;
  const invoice: DecodedInvoice = {
    network: parseNetwork(decoded.network?.bech32),
    timestamp: parseTimestamp(decoded.timestamp),
    expirySeconds: parseExpirySeconds(tags.expire_time),
    payeeNodeId: parsePayeeNodeId(decoded.payeeNodeKey),
    payeeNodeIdSource: tags.payee_node_key ? "n" : "signature",
  };

  const amountMsat = parseAmountMsat(decoded.millisatoshis);
  if (amountMsat !== undefined) invoice.amountMsat = amountMsat;

  const descriptionHash = parseDescriptionHash(tags.purpose_commit_hash);
  if (descriptionHash !== undefined) invoice.descriptionHash = descriptionHash;

  return invoice;
}

export async function assertBolt11Payment(
  pr: string,
  payRequest: PayRequest,
  options: RequestPaymentOptions,
): Promise<Bolt11PayeeNodeInfo> {
  const invoice = decodeBolt11(pr);

  if (options.expectedNetwork && invoice.network !== options.expectedNetwork) {
    throw new InvalidCallbackResponseError(
      `BOLT11 invoice network ${invoice.network} does not match expected network ${options.expectedNetwork}`,
    );
  }

  if (invoice.amountMsat === undefined) {
    throw new InvalidCallbackResponseError("BOLT11 invoice must include an amount");
  }

  const expectedAmount = BigInt(amountToMsatString(options.amountMsat));
  if (invoice.amountMsat !== expectedAmount) {
    throw new InvalidCallbackResponseError(
      `BOLT11 invoice amount ${invoice.amountMsat.toString()} does not match requested amount ${expectedAmount.toString()}`,
    );
  }

  if (options.validateMetadataHash) {
    if (!invoice.descriptionHash) {
      throw new InvalidCallbackResponseError("BOLT11 invoice description hash is missing");
    }
    if (invoice.descriptionHash !== payRequest.metadataHash) {
      throw new InvalidCallbackResponseError(
        "BOLT11 invoice description hash does not match payRequest metadata",
      );
    }
  }

  if (options.validateExpiry !== false) {
    const expiresAt = invoice.timestamp + invoice.expirySeconds;
    if (expiresAt <= nowSeconds(options.now)) {
      throw new InvalidCallbackResponseError("BOLT11 invoice is expired");
    }
  }

  return {
    payeeNodeId: invoice.payeeNodeId,
    payeeNodeIdSource: invoice.payeeNodeIdSource,
  };
}
