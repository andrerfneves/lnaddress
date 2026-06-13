import { InvalidPayRequestError } from "./errors";
import { sha256 } from "./sha256";
import type { MetadataEntry, MetadataImage } from "./types";

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

export function parseMetadata(metadataString: string): MetadataEntry[] {
  let decoded: unknown;

  try {
    decoded = JSON.parse(metadataString);
  } catch (cause) {
    throw new InvalidPayRequestError("Pay request metadata is not valid JSON", { cause });
  }

  if (!Array.isArray(decoded)) {
    throw new InvalidPayRequestError("Pay request metadata must be a JSON array");
  }

  return decoded.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new InvalidPayRequestError(`Metadata entry ${index} must be a tuple`);
    }

    const [mimeType, value] = entry;
    if (typeof mimeType !== "string" || typeof value !== "string") {
      throw new InvalidPayRequestError(`Metadata entry ${index} must contain string values`);
    }

    return [mimeType, value];
  });
}

export function getMetadataHash(metadataString: string): string {
  const bytes = new TextEncoder().encode(metadataString);
  return [...sha256(bytes)].map(toHex).join("");
}

export function getDescription(metadata: MetadataEntry[]): string | undefined {
  return metadata.find(([mimeType]) => mimeType === "text/plain")?.[1];
}

export function getImage(metadata: MetadataEntry[]): MetadataImage | undefined {
  const entry = metadata.find(([mimeType]) => mimeType.startsWith("image/"));

  if (!entry) {
    return undefined;
  }

  const [mimeType, data] = entry;
  const dataUri_mimeType = mimeType.endsWith(";base64") ? mimeType : `${mimeType};base64`;
  return {
    mimeType,
    data,
    dataUri: `data:${dataUri_mimeType},${data}`,
  };
}
