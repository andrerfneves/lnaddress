import { recoverPublicKeyAsync, verifyAsync } from "@noble/secp256k1";
import { InvalidCallbackResponseError } from "./errors";
import { amountToMsatString } from "./internal";
import { sha256 } from "./sha256";
import type { Bolt11Network, ConvertedAmount, PayRequest, RequestPaymentOptions } from "./types";

const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const signatureWordCount = 104;

type DecodedInvoice = {
  network: Bolt11Network;
  timestamp: number;
  expirySeconds: number;
  signingHash: Uint8Array;
  signature: Uint8Array;
  amountMsat?: bigint;
  descriptionHash?: string;
  payeeNodeId?: string;
};

const hrpNetworks: Record<string, Bolt11Network> = {
  bc: "bitcoin",
  tb: "testnet",
  bcrt: "regtest",
  sb: "signet",
};

function polymod(values: number[]): number {
  let chk = 1;

  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;

    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) {
        chk ^= generator[i] ?? 0;
      }
    }
  }

  return chk;
}

function hrpExpand(hrp: string): number[] {
  const expanded: number[] = [];

  for (let i = 0; i < hrp.length; i += 1) {
    expanded.push(hrp.charCodeAt(i) >> 5);
  }

  expanded.push(0);

  for (let i = 0; i < hrp.length; i += 1) {
    expanded.push(hrp.charCodeAt(i) & 31);
  }

  return expanded;
}

function verifyChecksum(hrp: string, data: number[]): boolean {
  return polymod([...hrpExpand(hrp), ...data]) === 1;
}

function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;

  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) {
      throw new InvalidCallbackResponseError("BOLT11 invoice contains invalid data");
    }

    acc = ((acc << fromBits) | value) & maxAcc;
    bits += fromBits;

    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      ret.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new InvalidCallbackResponseError("BOLT11 invoice data padding is invalid");
  }

  return ret;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function wordsToInt(words: number[]): bigint {
  return words.reduce((value, word) => (value << 5n) | BigInt(word), 0n);
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

function parseHrp(hrp: string): Pick<DecodedInvoice, "network" | "amountMsat"> {
  const networkPrefix = ["bcrt", "bc", "tb", "sb"].find((candidate) =>
    hrp.startsWith(`ln${candidate}`),
  );

  if (!networkPrefix) {
    throw new InvalidCallbackResponseError("BOLT11 invoice network prefix is invalid");
  }

  const network = hrpNetworks[networkPrefix];
  if (!network) {
    throw new InvalidCallbackResponseError("BOLT11 invoice network prefix is invalid");
  }

  const amountPart = hrp.slice(`ln${networkPrefix}`.length);
  if (!amountPart) {
    return { network };
  }

  const match = amountPart.match(/^(\d+)([munp]?)$/);
  if (!match) {
    throw new InvalidCallbackResponseError("BOLT11 invoice amount is invalid");
  }

  const amount = BigInt(match[1] ?? "0");
  const unit = match[2] ?? "";

  if (unit === "m") {
    return { network, amountMsat: amount * 100_000_000n };
  }
  if (unit === "u") {
    return { network, amountMsat: amount * 100_000n };
  }
  if (unit === "n") {
    return { network, amountMsat: amount * 100n };
  }
  if (unit === "p") {
    if (amount % 10n !== 0n) {
      throw new InvalidCallbackResponseError(
        "BOLT11 invoice amount is below millisatoshi precision",
      );
    }
    return { network, amountMsat: amount / 10n };
  }

  return { network, amountMsat: amount * 100_000_000_000n };
}

function decodeBolt11(pr: string): DecodedInvoice {
  const value = pr.trim();
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) {
    throw new InvalidCallbackResponseError("BOLT11 invoice must not mix upper and lower case");
  }

  const normalized = value.toLowerCase();
  const separatorIndex = normalized.lastIndexOf("1");
  if (separatorIndex <= 0 || separatorIndex + 7 > normalized.length) {
    throw new InvalidCallbackResponseError("BOLT11 invoice separator or checksum is invalid");
  }

  const hrp = normalized.slice(0, separatorIndex);
  const data = [...normalized.slice(separatorIndex + 1)].map((char) => {
    const index = charset.indexOf(char);
    if (index === -1) {
      throw new InvalidCallbackResponseError("BOLT11 invoice contains an invalid character");
    }
    return index;
  });

  if (!verifyChecksum(hrp, data)) {
    throw new InvalidCallbackResponseError("BOLT11 invoice checksum is invalid");
  }

  const payload = data.slice(0, -6);
  if (payload.length < 7 + signatureWordCount) {
    throw new InvalidCallbackResponseError("BOLT11 invoice payload is too short");
  }

  const taggedFieldsEnd = payload.length - signatureWordCount;
  const signingWords = payload.slice(0, taggedFieldsEnd);
  const signatureBytes = Uint8Array.from(convertBits(payload.slice(taggedFieldsEnd), 5, 8, false));
  if (signatureBytes.length !== 65) {
    throw new InvalidCallbackResponseError("BOLT11 invoice signature is invalid");
  }

  const timestamp = Number(wordsToInt(payload.slice(0, 7)));
  const invoice: DecodedInvoice = {
    ...parseHrp(hrp),
    timestamp,
    expirySeconds: 3600,
    signingHash: sha256(
      concatBytes(
        new TextEncoder().encode(hrp),
        Uint8Array.from(convertBits(signingWords, 5, 8, true)),
      ),
    ),
    signature: signatureBytes,
  };

  let offset = 7;

  while (offset < taggedFieldsEnd) {
    const tag = payload[offset];
    const length = ((payload[offset + 1] ?? 0) << 5) | (payload[offset + 2] ?? 0);
    offset += 3;
    const end = offset + length;
    if (end > taggedFieldsEnd) {
      throw new InvalidCallbackResponseError("BOLT11 invoice tagged field is truncated");
    }

    if (charset[tag ?? -1] === "h") {
      const hashBytes = convertBits(payload.slice(offset, end), 5, 8, false);
      if (hashBytes.length !== 32) {
        throw new InvalidCallbackResponseError("BOLT11 invoice description hash is invalid");
      }
      invoice.descriptionHash = bytesToHex(hashBytes);
    }

    if (charset[tag ?? -1] === "x") {
      invoice.expirySeconds = Number(wordsToInt(payload.slice(offset, end)));
    }

    if (charset[tag ?? -1] === "n") {
      const nodeIdBytes = convertBits(payload.slice(offset, end), 5, 8, false);
      if (nodeIdBytes.length !== 33) {
        throw new InvalidCallbackResponseError("BOLT11 invoice payee node id is invalid");
      }
      invoice.payeeNodeId = bytesToHex(nodeIdBytes);
    }

    offset = end;
  }

  return invoice;
}

function convertedAmountMsat(converted: ConvertedAmount): bigint {
  const calculated = converted.amount * converted.multiplier + converted.fee;
  const rounded = Math.round(calculated);
  if (!Number.isSafeInteger(rounded) || Math.abs(calculated - rounded) > 1e-6) {
    throw new InvalidCallbackResponseError(
      "converted amount formula must produce a safe integer millisatoshi amount",
    );
  }

  return BigInt(rounded);
}

export function assertBolt11Payment(
  pr: string,
  payRequest: PayRequest,
  options: RequestPaymentOptions,
  converted?: ConvertedAmount,
): Promise<void> {
  const invoice = decodeBolt11(pr);

  if (options.expectedNetwork && invoice.network !== options.expectedNetwork) {
    throw new InvalidCallbackResponseError(
      `BOLT11 invoice network ${invoice.network} does not match expected network ${options.expectedNetwork}`,
    );
  }

  if (invoice.amountMsat === undefined) {
    throw new InvalidCallbackResponseError("BOLT11 invoice must include an amount");
  }

  if (options.amountMsat !== undefined) {
    const expectedAmount = BigInt(amountToMsatString(options.amountMsat));
    if (invoice.amountMsat !== expectedAmount) {
      throw new InvalidCallbackResponseError(
        `BOLT11 invoice amount ${invoice.amountMsat.toString()} does not match requested amount ${expectedAmount.toString()}`,
      );
    }
  }

  if (converted) {
    const expectedConvertedAmount = convertedAmountMsat(converted);
    if (invoice.amountMsat !== expectedConvertedAmount) {
      throw new InvalidCallbackResponseError(
        `BOLT11 invoice amount ${invoice.amountMsat.toString()} does not match converted amount ${expectedConvertedAmount.toString()}`,
      );
    }
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

  return assertBolt11Signature(invoice);
}

async function assertBolt11Signature(invoice: DecodedInvoice): Promise<void> {
  const recoveredSignature = new Uint8Array([
    invoice.signature[64] ?? 0,
    ...invoice.signature.slice(0, 64),
  ]);
  let publicKey: Uint8Array;
  try {
    publicKey = await recoverPublicKeyAsync(recoveredSignature, invoice.signingHash, {
      prehash: false,
    });
  } catch (cause) {
    throw new InvalidCallbackResponseError("BOLT11 invoice signature recovery failed", { cause });
  }

  const valid = await verifyAsync(invoice.signature.slice(0, 64), invoice.signingHash, publicKey, {
    prehash: false,
    lowS: false,
  });
  if (!valid) {
    throw new InvalidCallbackResponseError("BOLT11 invoice signature is invalid");
  }

  if (invoice.payeeNodeId && bytesToHex([...publicKey]) !== invoice.payeeNodeId) {
    throw new InvalidCallbackResponseError("BOLT11 invoice signature does not match payee node id");
  }
}
