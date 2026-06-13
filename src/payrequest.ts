import { z } from "zod";
import { InvalidPayRequestError, InvalidPaymentOptionError } from "./errors";
import { assertHttpUrl, toMsatBigint, unknownToRecord } from "./internal";
import { getDescription, getImage, getMetadataHash, parseMetadata } from "./metadata";
import type {
  LightningAddress,
  PayRequest,
  PayerData,
  PayerDataField,
  PaymentOption,
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
  sourceUrl?: string;
  lightningAddress?: LightningAddress;
};

function parse_payerData(raw: unknown): PayerData | undefined {
  const record = unknownToRecord(raw);
  if (!record) {
    return undefined;
  }

  const payerData: PayerData = {};

  for (const [field, config] of Object.entries(record)) {
    const config_record = unknownToRecord(config) ?? {};
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

    payerData[field] = parsed_field;
  }

  return payerData;
}

function parse_paymentOptions(raw: unknown): PaymentOption[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const paymentOptions: PaymentOption[] = [];
  const seen_ids = new Set<string>();

  for (const [index, entry] of raw.entries()) {
    const record = unknownToRecord(entry);
    if (!record) {
      throw new InvalidPaymentOptionError(`paymentOptions entry ${index} must be an object`);
    }

    if (typeof record.id !== "string") {
      throw new InvalidPaymentOptionError(`paymentOptions entry ${index} must have a string id`);
    }

    if (typeof record.type !== "string") {
      throw new InvalidPaymentOptionError(`paymentOptions entry ${index} must have a string type`);
    }

    if (seen_ids.has(record.id)) {
      throw new InvalidPaymentOptionError(`paymentOptions contains duplicate id: ${record.id}`);
    }
    seen_ids.add(record.id);

    const option: PaymentOption = {
      id: record.id,
      type: record.type,
      raw: record,
    };

    if (typeof record.available === "boolean") {
      option.available = record.available;
    }

    if (record.minSendable !== undefined) {
      try {
        option.minSendableMsat = toMsatBigint(
          record.minSendable,
          `paymentOptions[${index}].minSendable`,
        );
      } catch (cause) {
        throw new InvalidPaymentOptionError(
          `paymentOptions entry ${index} has invalid minSendable`,
          { cause },
        );
      }
    }

    if (record.maxSendable !== undefined) {
      try {
        option.maxSendableMsat = toMsatBigint(
          record.maxSendable,
          `paymentOptions[${index}].maxSendable`,
        );
      } catch (cause) {
        throw new InvalidPaymentOptionError(
          `paymentOptions entry ${index} has invalid maxSendable`,
          { cause },
        );
      }
    }

    if (
      option.minSendableMsat !== undefined &&
      option.maxSendableMsat !== undefined &&
      option.minSendableMsat > option.maxSendableMsat
    ) {
      throw new InvalidPaymentOptionError(
        `paymentOptions entry ${index} minSendable must be less than or equal to maxSendable`,
      );
    }

    paymentOptions.push(option);
  }

  return paymentOptions;
}

export function parsePayRequestResponse(
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
    assertHttpUrl(parsed.data.callback, context);
  } catch (cause) {
    throw new InvalidPayRequestError("Pay request callback URL is invalid", { cause });
  }

  let minSendableMsat: bigint;
  let maxSendableMsat: bigint;

  try {
    minSendableMsat = toMsatBigint(parsed.data.minSendable, "minSendable");
    maxSendableMsat = toMsatBigint(parsed.data.maxSendable, "maxSendable");
  } catch (cause) {
    throw new InvalidPayRequestError("Pay request amount bounds are invalid", { cause });
  }

  if (minSendableMsat > maxSendableMsat) {
    throw new InvalidPayRequestError(
      "Pay request minSendable must be less than or equal to maxSendable",
    );
  }

  const metadata = parseMetadata(parsed.data.metadata);
  const description = getDescription(metadata);
  if (!description) {
    throw new InvalidPayRequestError("Pay request metadata must include a text/plain description");
  }

  const pay_request: PayRequest = {
    tag: "payRequest",
    callback: parsed.data.callback,
    minSendableMsat,
    maxSendableMsat,
    metadata,
    metadataRaw: parsed.data.metadata,
    metadataHash: getMetadataHash(parsed.data.metadata),
    raw,
  };

  pay_request.description = description;

  const image = getImage(metadata);
  if (image) {
    pay_request.image = image;
  }

  if (parsed.data.commentAllowed !== undefined) {
    pay_request.commentAllowed = parsed.data.commentAllowed;
  }

  const payerData = parse_payerData(parsed.data.payerData);
  if (payerData) {
    pay_request.payerData = payerData;
  }

  const paymentOptions = parse_paymentOptions(parsed.data.paymentOptions);
  if (paymentOptions) {
    pay_request.paymentOptions = paymentOptions;
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

  if (context.sourceUrl) {
    pay_request.sourceUrl = context.sourceUrl;
  }

  if (context.lightningAddress) {
    pay_request.lightningAddress = context.lightningAddress;
  }

  return pay_request;
}

export function isPayRequest(value: unknown): value is PayRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PayRequest>;
  return (
    candidate.tag === "payRequest" &&
    typeof candidate.callback === "string" &&
    typeof candidate.minSendableMsat === "bigint" &&
    typeof candidate.maxSendableMsat === "bigint" &&
    Array.isArray(candidate.metadata)
  );
}
