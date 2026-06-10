import { InvalidPayRequestError } from "./errors";
import { sha256 } from "./sha256";
import type { MetadataEntry, MetadataImage } from "./types";

function to_hex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

export function parse_metadata(metadata_string: string): MetadataEntry[] {
  let decoded: unknown;

  try {
    decoded = JSON.parse(metadata_string);
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

    const [mime_type, value] = entry;
    if (typeof mime_type !== "string" || typeof value !== "string") {
      throw new InvalidPayRequestError(`Metadata entry ${index} must contain string values`);
    }

    return [mime_type, value];
  });
}

export function get_metadata_hash(metadata_string: string): string {
  const bytes = new TextEncoder().encode(metadata_string);
  return [...sha256(bytes)].map(to_hex).join("");
}

export function get_description(metadata: MetadataEntry[]): string | undefined {
  return metadata.find(([mime_type]) => mime_type === "text/plain")?.[1];
}

export function get_image(metadata: MetadataEntry[]): MetadataImage | undefined {
  const entry = metadata.find(([mime_type]) => mime_type.startsWith("image/"));

  if (!entry) {
    return undefined;
  }

  const [mime_type, data] = entry;
  const data_uri_mime_type = mime_type.endsWith(";base64") ? mime_type : `${mime_type};base64`;
  return {
    mime_type,
    data,
    data_uri: `data:${data_uri_mime_type},${data}`,
  };
}
