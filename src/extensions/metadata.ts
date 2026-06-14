import { sha256 } from "js-sha256";
import { InvalidPayRequestError } from "../core/errors";
import type { MetadataEntry, MetadataImage } from "../core/types";

export function parseMetadata(metadataString: string): MetadataEntry[] {
  let decoded: unknown;

  try {
    decoded = JSON.parse(metadataString);
  } catch (cause) {
    throw new InvalidPayRequestError("Pay request metadata is not valid JSON", {
      cause,
    });
  }

  if (!Array.isArray(decoded)) {
    throw new InvalidPayRequestError("Pay request metadata must be a JSON array");
  }

  return decoded.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new InvalidPayRequestError(`Metadata entry ${index} must be a tuple`);
    }

    const [mimeType, value] = entry;
    if (typeof mimeType !== "string") {
      throw new InvalidPayRequestError(`Metadata entry ${index} must have a string type`);
    }

    return [mimeType, value];
  });
}

export function getMetadataHash(metadataString: string): string {
  return sha256(metadataString);
}

export function getDescription(metadata: MetadataEntry[]): string | undefined {
  const entry = metadata.find(([mimeType]) => mimeType === "text/plain");
  if (!entry) return undefined;
  const value = entry[1];
  return typeof value === "string" ? value : undefined;
}

export function getImage(metadata: MetadataEntry[]): MetadataImage | undefined {
  const entry = metadata.find(([mimeType]) => mimeType.startsWith("image/"));
  if (!entry) return undefined;

  const mimeType = entry[0];
  const data = entry[1];
  if (typeof data !== "string") return undefined;

  const dataUri_mimeType = mimeType.endsWith(";base64") ? mimeType : `${mimeType};base64`;
  return {
    mimeType,
    data,
    dataUri: `data:${dataUri_mimeType},${data}`,
  };
}
