import { InvalidLnurlError } from "./errors";
import { assertHttpUrl } from "./internal";
import type { UrlSafetyOptions } from "./types";

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

function verifyChecksum(hrp: string, data: number[]): boolean {
  return polymod([...hrpExpand(hrp), ...data]) === 1;
}

function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  const max_acc = (1 << (fromBits + toBits - 1)) - 1;

  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) {
      throw new InvalidLnurlError("LNURL data contains an invalid value");
    }

    acc = ((acc << fromBits) | value) & max_acc;
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
    throw new InvalidLnurlError("LNURL data padding is invalid");
  }

  return ret;
}

export function encodeLnurl(url: string, options: UrlSafetyOptions = {}): string {
  let parsed: URL;

  try {
    parsed = assertHttpUrl(url, options);
  } catch (cause) {
    throw new InvalidLnurlError("LNURL can only encode valid http or https URLs", { cause });
  }

  const bytes = [...new TextEncoder().encode(parsed.toString())];
  const data = convertBits(bytes, 8, 5, true);
  const combined = [...data, ...createChecksum("lnurl", data)];

  return `lnurl1${combined.map((value) => charset[value]).join("")}`;
}

export function decodeLnurl(lnurl: string, options: UrlSafetyOptions = {}): string {
  const value = lnurl.trim();

  if (value !== value.toLowerCase() && value !== value.toUpperCase()) {
    throw new InvalidLnurlError("LNURL bech32 strings must not mix upper and lower case");
  }

  const normalized = value.toLowerCase();
  const separator_index = normalized.lastIndexOf("1");

  if (separator_index <= 0 || separator_index + 7 > normalized.length) {
    throw new InvalidLnurlError("LNURL bech32 separator or checksum is invalid");
  }

  const hrp = normalized.slice(0, separator_index);
  if (hrp !== "lnurl") {
    throw new InvalidLnurlError("LNURL bech32 human-readable part must be lnurl");
  }

  const data_part = normalized.slice(separator_index + 1);
  const data = [...data_part].map((char) => {
    const index = charset.indexOf(char);
    if (index === -1) {
      throw new InvalidLnurlError("LNURL bech32 string contains an invalid character");
    }
    return index;
  });

  if (!verifyChecksum(hrp, data)) {
    throw new InvalidLnurlError("LNURL bech32 checksum is invalid");
  }

  const payload = data.slice(0, -6);
  const bytes = convertBits(payload, 5, 8, false);
  const url = new TextDecoder().decode(new Uint8Array(bytes));

  try {
    return assertHttpUrl(url, options).toString();
  } catch (cause) {
    throw new InvalidLnurlError("Decoded LNURL does not contain a valid http or https URL", {
      cause,
    });
  }
}
