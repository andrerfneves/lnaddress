// Minimal BIP-173 bech32 codec shared by LNURL and BOLT11.
// Length limits are intentionally not enforced: both LNURL and BOLT11 exceed 90 characters.

const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export class Bech32Error extends TypeError {}

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

/**
 * Regroups bits between word sizes (e.g. 8-bit bytes and 5-bit bech32 words).
 * `label` prefixes error messages, e.g. "LNURL data".
 */
export function convertBits(
  data: ArrayLike<number>,
  fromBits: number,
  toBits: number,
  pad: boolean,
  label = "bech32 data",
): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;

  for (let index = 0; index < data.length; index += 1) {
    const value = data[index] ?? -1;
    if (value < 0 || value >> fromBits !== 0) {
      throw new Bech32Error(`${label} contains an invalid value`);
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
    throw new Bech32Error(`${label} padding is invalid`);
  }

  return ret;
}

export function encodeBech32(hrp: string, words: number[]): string {
  const combined = [...words, ...createChecksum(hrp, words)];
  return `${hrp}1${combined.map((value) => charset[value]).join("")}`;
}

export type DecodedBech32 = {
  /** Lower-cased human-readable part. */
  hrp: string;
  /** 5-bit data words with the 6-word checksum removed. */
  words: number[];
};

/**
 * Decodes a bech32 string. `label` prefixes error messages, e.g. "LNURL bech32".
 */
export function decodeBech32(input: string, label = "bech32"): DecodedBech32 {
  const value = input.trim();

  if (value !== value.toLowerCase() && value !== value.toUpperCase()) {
    throw new Bech32Error(`${label} strings must not mix upper and lower case`);
  }

  const normalized = value.toLowerCase();
  const separatorIndex = normalized.lastIndexOf("1");

  if (separatorIndex <= 0 || separatorIndex + 7 > normalized.length) {
    throw new Bech32Error(`${label} separator or checksum is invalid`);
  }

  const hrp = normalized.slice(0, separatorIndex);
  for (let i = 0; i < hrp.length; i += 1) {
    const code = hrp.charCodeAt(i);
    if (code < 33 || code > 126) {
      throw new Bech32Error(`${label} human-readable part is invalid`);
    }
  }

  const data = [...normalized.slice(separatorIndex + 1)].map((char) => {
    const index = charset.indexOf(char);
    if (index === -1) {
      throw new Bech32Error(`${label} string contains an invalid character`);
    }
    return index;
  });

  if (polymod([...hrpExpand(hrp), ...data]) !== 1) {
    throw new Bech32Error(`${label} checksum is invalid`);
  }

  return { hrp, words: data.slice(0, -6) };
}
