import { getPublicKey, signAsync } from "@noble/secp256k1";
import { sha256 } from "../../src/sha256";

const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const private_key = new Uint8Array(32).fill(1);

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

function createChecksum(hrp: string, data: number[]): number[] {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  const checksum: number[] = [];

  for (let p = 0; p < 6; p += 1) {
    checksum.push((mod >> (5 * (5 - p))) & 31);
  }

  return checksum;
}

function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  const max_acc = (1 << (fromBits + toBits - 1)) - 1;

  for (const value of data) {
    acc = ((acc << fromBits) | value) & max_acc;
    bits += fromBits;

    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }

  if (pad && bits > 0) {
    ret.push((acc << (toBits - bits)) & maxv);
  }

  return ret;
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];

  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }

  return bytes;
}

function concat_bytes(...chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function int_to_words(value: number | bigint, word_count?: number): number[] {
  let remaining = typeof value === "bigint" ? value : BigInt(value);
  const words: number[] = [];

  while (remaining > 0n) {
    words.unshift(Number(remaining & 31n));
    remaining >>= 5n;
  }

  if (word_count !== undefined) {
    while (words.length < word_count) {
      words.unshift(0);
    }
  }

  return words;
}

export async function test_bolt11_invoice(
  amountMsat: number | bigint,
  metadataHash: string,
  options: {
    network?: "bc" | "tb" | "bcrt" | "sb";
    timestamp?: number;
    expiry_seconds?: number;
    mismatched_payee_node?: boolean;
  } = {},
): Promise<string> {
  const amount = typeof amountMsat === "bigint" ? amountMsat : BigInt(amountMsat);
  const hrp = `ln${options.network ?? "bc"}${(amount * 10n).toString()}p`;
  const timestamp = int_to_words(options.timestamp ?? Math.floor(Date.now() / 1000), 7);
  const hash_words = convertBits(hexToBytes(metadataHash), 8, 5, true);
  const h_tag = charset.indexOf("h");
  const h_length = [hash_words.length >> 5, hash_words.length & 31];
  const node_key = options.mismatched_payee_node ? new Uint8Array(32).fill(2) : private_key;
  const node_id_words = convertBits([...getPublicKey(node_key)], 8, 5, true);
  const node_id_field = [
    charset.indexOf("n"),
    node_id_words.length >> 5,
    node_id_words.length & 31,
    ...node_id_words,
  ];
  const expiry_words =
    options.expiry_seconds === undefined ? [] : int_to_words(options.expiry_seconds);
  const expiry_field =
    expiry_words.length === 0
      ? []
      : [charset.indexOf("x"), expiry_words.length >> 5, expiry_words.length & 31, ...expiry_words];
  const signing_data = [
    ...timestamp,
    h_tag,
    ...h_length,
    ...hash_words,
    ...node_id_field,
    ...expiry_field,
  ];
  const signing_hash = sha256(
    concat_bytes(
      new TextEncoder().encode(hrp),
      new Uint8Array(convertBits(signing_data, 5, 8, true)),
    ),
  );
  const recovered_signature = await signAsync(signing_hash, private_key, {
    format: "recovered",
    prehash: false,
    lowS: false,
  });
  const signature = new Uint8Array([...recovered_signature.slice(1), recovered_signature[0] ?? 0]);
  const data = [...signing_data, ...convertBits([...signature], 8, 5, true)];
  const combined = [...data, ...createChecksum(hrp, data)];

  return `${hrp}1${combined.map((value) => charset[value]).join("")}`;
}
