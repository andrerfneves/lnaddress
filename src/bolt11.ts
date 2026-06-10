import { InvalidCallbackResponseError } from "./errors";
import { amount_to_msat_string } from "./internal";
import type { Bolt11Network, PayRequest, RequestPaymentOptions } from "./types";

const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const signature_word_count = 104;

type DecodedInvoice = {
  network: Bolt11Network;
  timestamp: number;
  expiry_seconds: number;
  amount_msat?: bigint;
  description_hash?: string;
};

const hrp_networks: Record<string, Bolt11Network> = {
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

function hrp_expand(hrp: string): number[] {
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

function verify_checksum(hrp: string, data: number[]): boolean {
  return polymod([...hrp_expand(hrp), ...data]) === 1;
}

function convert_bits(data: number[], from_bits: number, to_bits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to_bits) - 1;
  const max_acc = (1 << (from_bits + to_bits - 1)) - 1;

  for (const value of data) {
    if (value < 0 || value >> from_bits !== 0) {
      throw new InvalidCallbackResponseError("BOLT11 invoice contains invalid data");
    }

    acc = ((acc << from_bits) | value) & max_acc;
    bits += from_bits;

    while (bits >= to_bits) {
      bits -= to_bits;
      ret.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      ret.push((acc << (to_bits - bits)) & maxv);
    }
  } else if (bits >= from_bits || ((acc << (to_bits - bits)) & maxv) !== 0) {
    throw new InvalidCallbackResponseError("BOLT11 invoice data padding is invalid");
  }

  return ret;
}

function bytes_to_hex(bytes: number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function words_to_int(words: number[]): bigint {
  return words.reduce((value, word) => (value << 5n) | BigInt(word), 0n);
}

function now_seconds(now: RequestPaymentOptions["now"]): number {
  const value = typeof now === "function" ? now() : now;
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  if (typeof value === "number") {
    return Math.floor(value);
  }
  return Math.floor(Date.now() / 1000);
}

function parse_hrp(hrp: string): Omit<DecodedInvoice, "timestamp" | "expiry_seconds"> {
  const network_prefix = ["bcrt", "bc", "tb", "sb"].find((candidate) =>
    hrp.startsWith(`ln${candidate}`),
  );

  if (!network_prefix) {
    throw new InvalidCallbackResponseError("BOLT11 invoice network prefix is invalid");
  }

  const network = hrp_networks[network_prefix];
  if (!network) {
    throw new InvalidCallbackResponseError("BOLT11 invoice network prefix is invalid");
  }

  const amount_part = hrp.slice(`ln${network_prefix}`.length);
  if (!amount_part) {
    return { network };
  }

  const match = amount_part.match(/^(\d+)([munp]?)$/);
  if (!match) {
    throw new InvalidCallbackResponseError("BOLT11 invoice amount is invalid");
  }

  const amount = BigInt(match[1] ?? "0");
  const unit = match[2] ?? "";

  if (unit === "m") {
    return { network, amount_msat: amount * 100_000_000n };
  }
  if (unit === "u") {
    return { network, amount_msat: amount * 100_000n };
  }
  if (unit === "n") {
    return { network, amount_msat: amount * 100n };
  }
  if (unit === "p") {
    if (amount % 10n !== 0n) {
      throw new InvalidCallbackResponseError(
        "BOLT11 invoice amount is below millisatoshi precision",
      );
    }
    return { network, amount_msat: amount / 10n };
  }

  return { network, amount_msat: amount * 100_000_000_000n };
}

function decode_bolt11(pr: string): DecodedInvoice {
  const value = pr.trim();
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) {
    throw new InvalidCallbackResponseError("BOLT11 invoice must not mix upper and lower case");
  }

  const normalized = value.toLowerCase();
  const separator_index = normalized.lastIndexOf("1");
  if (separator_index <= 0 || separator_index + 7 > normalized.length) {
    throw new InvalidCallbackResponseError("BOLT11 invoice separator or checksum is invalid");
  }

  const hrp = normalized.slice(0, separator_index);
  const data = [...normalized.slice(separator_index + 1)].map((char) => {
    const index = charset.indexOf(char);
    if (index === -1) {
      throw new InvalidCallbackResponseError("BOLT11 invoice contains an invalid character");
    }
    return index;
  });

  if (!verify_checksum(hrp, data)) {
    throw new InvalidCallbackResponseError("BOLT11 invoice checksum is invalid");
  }

  const payload = data.slice(0, -6);
  if (payload.length < 7 + signature_word_count) {
    throw new InvalidCallbackResponseError("BOLT11 invoice payload is too short");
  }

  const timestamp = Number(words_to_int(payload.slice(0, 7)));
  const invoice: DecodedInvoice = {
    ...parse_hrp(hrp),
    timestamp,
    expiry_seconds: 3600,
  };

  let offset = 7;
  const tagged_fields_end = payload.length - signature_word_count;

  while (offset < tagged_fields_end) {
    const tag = payload[offset];
    const length = ((payload[offset + 1] ?? 0) << 5) | (payload[offset + 2] ?? 0);
    offset += 3;
    const end = offset + length;
    if (end > tagged_fields_end) {
      throw new InvalidCallbackResponseError("BOLT11 invoice tagged field is truncated");
    }

    if (charset[tag ?? -1] === "h") {
      const hash_bytes = convert_bits(payload.slice(offset, end), 5, 8, false);
      if (hash_bytes.length !== 32) {
        throw new InvalidCallbackResponseError("BOLT11 invoice description hash is invalid");
      }
      invoice.description_hash = bytes_to_hex(hash_bytes);
    }

    if (charset[tag ?? -1] === "x") {
      invoice.expiry_seconds = Number(words_to_int(payload.slice(offset, end)));
    }

    offset = end;
  }

  return invoice;
}

export function assert_bolt11_payment(
  pr: string,
  pay_request: PayRequest,
  options: RequestPaymentOptions,
): void {
  const invoice = decode_bolt11(pr);
  const expected_amount = BigInt(amount_to_msat_string(options.amount_msat));

  if (options.expected_network && invoice.network !== options.expected_network) {
    throw new InvalidCallbackResponseError(
      `BOLT11 invoice network ${invoice.network} does not match expected network ${options.expected_network}`,
    );
  }

  if (invoice.amount_msat === undefined) {
    throw new InvalidCallbackResponseError("BOLT11 invoice must include an amount");
  }

  if (invoice.amount_msat !== expected_amount) {
    throw new InvalidCallbackResponseError(
      `BOLT11 invoice amount ${invoice.amount_msat.toString()} does not match requested amount ${expected_amount.toString()}`,
    );
  }

  if (!invoice.description_hash) {
    throw new InvalidCallbackResponseError("BOLT11 invoice must include a description hash");
  }

  if (invoice.description_hash !== pay_request.metadata_hash) {
    throw new InvalidCallbackResponseError(
      "BOLT11 invoice description hash does not match metadata",
    );
  }

  if (options.validate_expiry !== false) {
    const expires_at = invoice.timestamp + invoice.expiry_seconds;
    if (expires_at <= now_seconds(options.now)) {
      throw new InvalidCallbackResponseError("BOLT11 invoice is expired");
    }
  }
}
