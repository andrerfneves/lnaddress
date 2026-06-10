const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

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

function create_checksum(hrp: string, data: number[]): number[] {
  const values = [...hrp_expand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  const checksum: number[] = [];

  for (let p = 0; p < 6; p += 1) {
    checksum.push((mod >> (5 * (5 - p))) & 31);
  }

  return checksum;
}

function convert_bits(data: number[], from_bits: number, to_bits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to_bits) - 1;
  const max_acc = (1 << (from_bits + to_bits - 1)) - 1;

  for (const value of data) {
    acc = ((acc << from_bits) | value) & max_acc;
    bits += from_bits;

    while (bits >= to_bits) {
      bits -= to_bits;
      ret.push((acc >> bits) & maxv);
    }
  }

  if (pad && bits > 0) {
    ret.push((acc << (to_bits - bits)) & maxv);
  }

  return ret;
}

function hex_to_bytes(hex: string): number[] {
  const bytes: number[] = [];

  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }

  return bytes;
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

export function test_bolt11_invoice(
  amount_msat: number | bigint,
  metadata_hash: string,
  options: {
    network?: "bc" | "tb" | "bcrt" | "sb";
    timestamp?: number;
    expiry_seconds?: number;
  } = {},
): string {
  const amount = typeof amount_msat === "bigint" ? amount_msat : BigInt(amount_msat);
  const hrp = `ln${options.network ?? "bc"}${(amount * 10n).toString()}p`;
  const timestamp = int_to_words(options.timestamp ?? Math.floor(Date.now() / 1000), 7);
  const hash_words = convert_bits(hex_to_bytes(metadata_hash), 8, 5, true);
  const h_tag = charset.indexOf("h");
  const h_length = [hash_words.length >> 5, hash_words.length & 31];
  const expiry_words =
    options.expiry_seconds === undefined ? [] : int_to_words(options.expiry_seconds);
  const expiry_field =
    expiry_words.length === 0
      ? []
      : [charset.indexOf("x"), expiry_words.length >> 5, expiry_words.length & 31, ...expiry_words];
  const signature = new Array<number>(104).fill(0);
  const data = [...timestamp, h_tag, ...h_length, ...hash_words, ...expiry_field, ...signature];
  const combined = [...data, ...create_checksum(hrp, data)];

  return `${hrp}1${combined.map((value) => charset[value]).join("")}`;
}
