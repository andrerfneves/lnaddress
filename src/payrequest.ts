import { z } from "zod";
import { InvalidPayRequestError } from "./errors";
import { assert_http_url, to_msat_bigint, unknown_to_record } from "./internal";
import { get_description, get_image, get_metadata_hash, parse_metadata } from "./metadata";
import type {
  LightningAddress,
  PayRequest,
  PayerData,
  PayerDataField,
  UrlSafetyOptions,
} from "./types";

const pay_request_schema = z
  .object({
    tag: z.literal("payRequest"),
    callback: z.string(),
    minSendable: z.union([z.number(), z.string(), z.bigint()]),
    maxSendable: z.union([z.number(), z.string(), z.bigint()]),
    metadata: z.string(),
    commentAllowed: z.number().int().nonnegative().optional(),
    payerData: z.record(z.unknown()).optional(),
    currencies: z.unknown().optional(),
    convert: z.unknown().optional(),
    converted: z.unknown().optional(),
  })
  .passthrough();

export type ParsePayRequestContext = UrlSafetyOptions & {
  source_url?: string;
  lightning_address?: LightningAddress;
};

function parse_payer_data(raw: unknown): PayerData | undefined {
  const record = unknown_to_record(raw);
  if (!record) {
    return undefined;
  }

  const payer_data: PayerData = {};

  for (const [field, config] of Object.entries(record)) {
    const config_record = unknown_to_record(config) ?? {};
    const parsed_field: PayerDataField = {
      raw: config_record,
    };

    if (typeof config_record.mandatory === "boolean") {
      parsed_field.mandatory = config_record.mandatory;
    }

    if (typeof config_record.name === "string") {
      parsed_field.name = config_record.name;
    }

    if (typeof config_record.k1 === "string") {
      parsed_field.k1 = config_record.k1;
    }

    payer_data[field] = parsed_field;
  }

  return payer_data;
}

export function parse_pay_request_response(
  raw: unknown,
  context: ParsePayRequestContext = {},
): PayRequest {
  const parsed = pay_request_schema.safeParse(raw);

  if (!parsed.success) {
    throw new InvalidPayRequestError("Resolved response is not a valid LUD-06 payRequest", {
      cause: parsed.error,
    });
  }

  try {
    assert_http_url(parsed.data.callback, context);
  } catch (cause) {
    throw new InvalidPayRequestError("Pay request callback URL is invalid", { cause });
  }

  let min_sendable_msat: bigint;
  let max_sendable_msat: bigint;

  try {
    min_sendable_msat = to_msat_bigint(parsed.data.minSendable, "minSendable");
    max_sendable_msat = to_msat_bigint(parsed.data.maxSendable, "maxSendable");
  } catch (cause) {
    throw new InvalidPayRequestError("Pay request amount bounds are invalid", { cause });
  }

  if (min_sendable_msat > max_sendable_msat) {
    throw new InvalidPayRequestError(
      "Pay request minSendable must be less than or equal to maxSendable",
    );
  }

  const metadata = parse_metadata(parsed.data.metadata);
  const pay_request: PayRequest = {
    tag: "payRequest",
    callback: parsed.data.callback,
    min_sendable_msat,
    max_sendable_msat,
    metadata,
    metadata_raw: parsed.data.metadata,
    metadata_hash: get_metadata_hash(parsed.data.metadata),
    raw,
  };

  const description = get_description(metadata);
  if (description) {
    pay_request.description = description;
  }

  const image = get_image(metadata);
  if (image) {
    pay_request.image = image;
  }

  if (parsed.data.commentAllowed !== undefined) {
    pay_request.comment_allowed = parsed.data.commentAllowed;
  }

  const payer_data = parse_payer_data(parsed.data.payerData);
  if (payer_data) {
    pay_request.payer_data = payer_data;
  }

  if (parsed.data.currencies !== undefined) {
    pay_request.currencies = parsed.data.currencies;
  }

  if (parsed.data.convert !== undefined) {
    pay_request.convert = parsed.data.convert;
  }

  if (parsed.data.converted !== undefined) {
    pay_request.converted = parsed.data.converted;
  }

  if (context.source_url) {
    pay_request.source_url = context.source_url;
  }

  if (context.lightning_address) {
    pay_request.lightning_address = context.lightning_address;
  }

  return pay_request;
}

export function is_pay_request(value: unknown): value is PayRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PayRequest>;
  return (
    candidate.tag === "payRequest" &&
    typeof candidate.callback === "string" &&
    typeof candidate.min_sendable_msat === "bigint" &&
    typeof candidate.max_sendable_msat === "bigint" &&
    Array.isArray(candidate.metadata)
  );
}
