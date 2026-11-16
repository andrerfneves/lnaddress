import { recoverPublicKeyAsync, verifyAsync } from "@noble/secp256k1";
import { sha256 } from "js-sha256";
import { InvalidCallbackResponseError } from "../core/errors";
import type { Bolt11Network, PayRequest, PaymentQuote, RequestPaymentOptions } from "../core/types";
import type { Bolt11PayeeNodeInfo } from "../extensions/node-pubkeys";
import { Bech32Error, convertBits, decodeBech32 } from "../utils/bech32";
import { amountToMsatString } from "../utils/internal";

// BOLT11 decoder built on the shared bech32 codec, js-sha256, and @noble/secp256k1.
// Spec: https://github.com/lightning/bolts/blob/master/11-payment-encoding.md

const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const signatureWordCount = 104;
const timestampWordCount = 7;
const defaultExpirySeconds = 3600;

/** HRP network prefixes from BOLT11, longest first so `bcrt`/`tbs` win over `bc`/`tb`. */
const networkPrefixes: Array<[prefix: string, network: Bolt11Network]> = [
  ["bcrt", "regtest"],
  ["tbs", "signet"],
  ["bc", "bitcoin"],
  ["tb", "testnet"],
];

/** Tagged fields whose data length is fixed. Fields with any other length MUST be skipped. */
const fixedLengthFields: Record<string, number> = {
  p: 52,
  h: 52,
  s: 52,
  n: 53,
};

export type DecodedBolt11 = Bolt11PayeeNodeInfo & {
  network: Bolt11Network;
  timestamp: number;
  expirySeconds: number;
  amountMsat?: bigint;
  paymentHash: string;
  descriptionHash?: string;
};

function invalid(message: string, cause?: unknown): InvalidCallbackResponseError {
  return new InvalidCallbackResponseError(message, cause === undefined ? undefined : { cause });
}

function bytesToHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function wordsToBytes(words: number[]): number[] {
  return convertBits(words, 5, 8, false, "BOLT11 invoice data");
}

function wordsToSafeInteger(words: number[], label: string): number {
  const value = words.reduce((total, word) => (total << 5n) | BigInt(word), 0n);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalid(`BOLT11 invoice ${label} is invalid`);
  }
  return Number(value);
}

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

function parseHrp(hrp: string): { network: Bolt11Network; amountMsat?: bigint } {
  if (!hrp.startsWith("ln")) {
    throw invalid("BOLT11 invoice network prefix is invalid");
  }

  const rest = hrp.slice(2);
  const match = networkPrefixes.find(
    ([prefix]) => rest.startsWith(prefix) && /^(\d|$)/.test(rest.slice(prefix.length)),
  );
  if (!match) {
    throw invalid("BOLT11 invoice network prefix is invalid");
  }

  const [prefix, network] = match;
  const amountPart = rest.slice(prefix.length);
  if (!amountPart) {
    return { network };
  }

  const amount = amountPart.match(/^(\d+)([munp]?)$/);
  if (!amount?.[1]) {
    throw invalid("BOLT11 invoice amount is invalid");
  }

  const value = BigInt(amount[1]);
  switch (amount[2]) {
    case "m":
      return { network, amountMsat: value * 100_000_000n };
    case "u":
      return { network, amountMsat: value * 100_000n };
    case "n":
      return { network, amountMsat: value * 100n };
    case "p":
      if (value % 10n !== 0n) {
        throw invalid("BOLT11 invoice amount is below millisatoshi precision");
      }
      return { network, amountMsat: value / 10n };
    default:
      return { network, amountMsat: value * 100_000_000_000n };
  }
}

async function recoverPayee(
  signature: Uint8Array,
  signingHash: Uint8Array,
  payeeNodeId: string | undefined,
): Promise<Bolt11PayeeNodeInfo> {
  const compact = signature.slice(0, 64);
  const recovery = signature[64] ?? 0;
  if (recovery > 3) {
    throw invalid("BOLT11 invoice signature recovery flag is invalid");
  }

  if (payeeNodeId) {
    // With an `n` field, readers MUST validate the signature against it instead of recovering.
    let valid = false;
    try {
      valid = await verifyAsync(compact, signingHash, hexToBytes(payeeNodeId), {
        prehash: false,
        lowS: false,
      });
    } catch (cause) {
      throw invalid("BOLT11 invoice signature is invalid", cause);
    }
    if (!valid) {
      throw invalid("BOLT11 invoice signature does not match payee node id");
    }
    return { payeeNodeId, payeeNodeIdSource: "n" };
  }

  let publicKey: Uint8Array;
  try {
    publicKey = await recoverPublicKeyAsync(new Uint8Array([recovery, ...compact]), signingHash, {
      prehash: false,
    });
  } catch (cause) {
    throw invalid("BOLT11 invoice signature recovery failed", cause);
  }

  return { payeeNodeId: bytesToHex(publicKey), payeeNodeIdSource: "signature" };
}

/**
 * Decodes a BOLT11 invoice and authenticates its signature. Throws
 * `InvalidCallbackResponseError` for anything a BOLT11 reader must reject.
 */
export async function decodeBolt11(pr: string): Promise<DecodedBolt11> {
  let hrp: string;
  let words: number[];
  try {
    ({ hrp, words } = decodeBech32(pr, "BOLT11 invoice"));
  } catch (cause) {
    throw invalid(
      cause instanceof Bech32Error ? cause.message : "BOLT11 invoice is invalid",
      cause,
    );
  }

  if (words.length < timestampWordCount + signatureWordCount) {
    throw invalid("BOLT11 invoice payload is too short");
  }

  const { network, amountMsat } = parseHrp(hrp);
  const taggedFieldsEnd = words.length - signatureWordCount;
  const signingWords = words.slice(0, taggedFieldsEnd);

  let signature: Uint8Array;
  let signingData: number[];
  try {
    signature = Uint8Array.from(wordsToBytes(words.slice(taggedFieldsEnd)));
    signingData = convertBits(signingWords, 5, 8, true);
  } catch (cause) {
    throw invalid("BOLT11 invoice signature is invalid", cause);
  }
  if (signature.length !== 65) {
    throw invalid("BOLT11 invoice signature is invalid");
  }

  const signingHash = Uint8Array.from(
    sha256.array([...new TextEncoder().encode(hrp), ...signingData]),
  );

  const timestamp = wordsToSafeInteger(words.slice(0, timestampWordCount), "timestamp");
  let expirySeconds = defaultExpirySeconds;
  let paymentHash: string | undefined;
  let descriptionHash: string | undefined;
  let payeeNodeId: string | undefined;

  let offset = timestampWordCount;
  while (offset < taggedFieldsEnd) {
    if (offset + 3 > taggedFieldsEnd) {
      throw invalid("BOLT11 invoice tagged field is truncated");
    }
    const tag = charset[words[offset] ?? -1] ?? "";
    const length = ((words[offset + 1] ?? 0) << 5) | (words[offset + 2] ?? 0);
    const start = offset + 3;
    const end = start + length;
    if (end > taggedFieldsEnd) {
      throw invalid("BOLT11 invoice tagged field is truncated");
    }
    offset = end;

    const expectedLength = fixedLengthFields[tag];
    if (expectedLength !== undefined && length !== expectedLength) {
      continue;
    }

    const fieldWords = words.slice(start, end);
    try {
      if (tag === "p" && paymentHash === undefined) {
        paymentHash = bytesToHex(wordsToBytes(fieldWords).slice(0, 32));
      } else if (tag === "h" && descriptionHash === undefined) {
        descriptionHash = bytesToHex(wordsToBytes(fieldWords).slice(0, 32));
      } else if (tag === "n" && payeeNodeId === undefined) {
        payeeNodeId = bytesToHex(wordsToBytes(fieldWords));
      } else if (tag === "x") {
        expirySeconds = wordsToSafeInteger(fieldWords, "expiry");
      }
    } catch (cause) {
      if (cause instanceof InvalidCallbackResponseError) {
        throw cause;
      }
      throw invalid(`BOLT11 invoice ${tag} field is invalid`, cause);
    }
  }

  if (!paymentHash) {
    throw invalid("BOLT11 invoice payment hash is missing");
  }

  const payee = await recoverPayee(signature, signingHash, payeeNodeId);

  const invoice: DecodedBolt11 = {
    network,
    timestamp,
    expirySeconds,
    paymentHash,
    ...payee,
  };
  if (amountMsat !== undefined) invoice.amountMsat = amountMsat;
  if (descriptionHash !== undefined) invoice.descriptionHash = descriptionHash;
  return invoice;
}

function expectedBolt11AmountMsat(
  options: RequestPaymentOptions,
  paymentQuote?: PaymentQuote,
): bigint {
  if (options.amountMsat !== undefined) {
    const expected = BigInt(amountToMsatString(options.amountMsat));
    if (paymentQuote?.payment.unit === "msat" && BigInt(paymentQuote.payment.amount) !== expected) {
      throw new InvalidCallbackResponseError(
        `paymentQuote.payment amount ${paymentQuote.payment.amount} does not match requested amount ${expected.toString()}`,
      );
    }
    return expected;
  }

  if (!paymentQuote) {
    throw new InvalidCallbackResponseError("BOLT11 unitAmount responses must include paymentQuote");
  }

  if (paymentQuote.payment.unit !== "msat") {
    throw new InvalidCallbackResponseError("BOLT11 paymentQuote.payment.unit must be msat");
  }

  return BigInt(paymentQuote.payment.amount);
}

export async function assertBolt11Payment(
  pr: string,
  payRequest: PayRequest,
  options: RequestPaymentOptions,
  paymentQuote?: PaymentQuote,
): Promise<Bolt11PayeeNodeInfo> {
  const invoice = await decodeBolt11(pr);

  if (options.expectedNetwork && invoice.network !== options.expectedNetwork) {
    throw new InvalidCallbackResponseError(
      `BOLT11 invoice network ${invoice.network} does not match expected network ${options.expectedNetwork}`,
    );
  }

  if (invoice.amountMsat === undefined) {
    throw new InvalidCallbackResponseError("BOLT11 invoice must include an amount");
  }

  const expectedAmount = expectedBolt11AmountMsat(options, paymentQuote);
  if (invoice.amountMsat !== expectedAmount) {
    const source = options.unitAmount !== undefined ? "paymentQuote.payment" : "requested amount";
    throw new InvalidCallbackResponseError(
      `BOLT11 invoice amount ${invoice.amountMsat.toString()} does not match ${source} ${expectedAmount.toString()}`,
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
