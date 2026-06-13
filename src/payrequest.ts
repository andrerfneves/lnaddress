import { z } from "zod";
import { InvalidPayRequestError, InvalidPaymentOptionError } from "./errors";
import { assertHttpUrl, toMsatBigint, unknownToRecord } from "./internal";
import { getDescription, getImage, getMetadataHash, parseMetadata } from "./metadata";
import type {
  Currency,
  CurrencyConvertible,
  LightningAddress,
  PayRequest,
  PayerData,
  PayerDataField,
  PaymentOption,
  UrlSafetyOptions,
} from "./types";

const payRequestSchema = z
  .object({
    tag: z.literal("payRequest"),
    callback: z.string(),
    minSendable: z.union([z.number(), z.string(), z.bigint()]),
    maxSendable: z.union([z.number(), z.string(), z.bigint()]),
    metadata: z.string(),
    commentAllowed: z.number().int().nonnegative().optional(),
    payerData: z.record(z.unknown()).optional(),
    paymentOptions: z.array(z.unknown()).optional(),
    currencies: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type ParsePayRequestContext = UrlSafetyOptions & {
  sourceUrl?: string;
  lightningAddress?: LightningAddress;
};

function parsePayerData(raw: unknown): PayerData | undefined {
  const record = unknownToRecord(raw);
  if (!record) {
    return undefined;
  }

  const payerData: PayerData = {};

  for (const [field, config] of Object.entries(record)) {
    const configRecord = unknownToRecord(config) ?? {};
    const parsedField: PayerDataField = {
      raw: configRecord,
    };

    if (typeof configRecord.mandatory === "boolean") {
      parsedField.mandatory = configRecord.mandatory;
    }

    if (typeof configRecord.name === "string") {
      parsedField.name = configRecord.name;
    }

    if (typeof configRecord.k1 === "string") {
      parsedField.k1 = configRecord.k1;
    }

    payerData[field] = parsedField;
  }

  return payerData;
}

function assertCurrencyCode(code: string, label: string): void {
  if (code.length === 0 || code.trim() !== code || code.includes(".")) {
    throw new InvalidPayRequestError(
      `${label} must be a non-empty currency code without whitespace or '.'`,
    );
  }
}

function parseCurrencyInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidPayRequestError(`${label} must be a non-negative safe integer`);
  }

  return value;
}

function parseCurrencyConvertible(raw: unknown, index: number): CurrencyConvertible {
  const record = unknownToRecord(raw);
  if (!record) {
    throw new InvalidPayRequestError(`currencies entry ${index} convertible must be an object`);
  }

  const min = parseCurrencyInteger(record.min, `currencies entry ${index} convertible.min`);
  const max = parseCurrencyInteger(record.max, `currencies entry ${index} convertible.max`);

  if (min > max) {
    throw new InvalidPayRequestError(
      `currencies entry ${index} convertible min must be less than or equal to max`,
    );
  }

  return { min, max };
}

function parseCurrencies(raw: unknown): Currency[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const currencies: Currency[] = [];
  const seenCodes = new Set<string>();

  for (const [index, entry] of raw.entries()) {
    const record = unknownToRecord(entry);
    if (!record) {
      throw new InvalidPayRequestError(`currencies entry ${index} must be an object`);
    }

    if (typeof record.code !== "string") {
      throw new InvalidPayRequestError(`currencies entry ${index} must have a string code`);
    }
    assertCurrencyCode(record.code, `currencies entry ${index} currency code`);

    if (typeof record.name !== "string") {
      throw new InvalidPayRequestError(`currencies entry ${index} must have a string name`);
    }

    if (typeof record.symbol !== "string") {
      throw new InvalidPayRequestError(`currencies entry ${index} must have a string symbol`);
    }

    if (
      typeof record.decimals !== "number" ||
      !Number.isSafeInteger(record.decimals) ||
      record.decimals < 0
    ) {
      throw new InvalidPayRequestError(
        `currencies entry ${index} must have non-negative safe integer decimals`,
      );
    }

    if (
      typeof record.multiplier !== "number" ||
      !Number.isFinite(record.multiplier) ||
      record.multiplier <= 0
    ) {
      throw new InvalidPayRequestError(
        `currencies entry ${index} must have a positive finite multiplier`,
      );
    }

    if (seenCodes.has(record.code)) {
      throw new InvalidPayRequestError(`currencies contains duplicate code: ${record.code}`);
    }
    seenCodes.add(record.code);

    const currency: Currency = {
      code: record.code,
      name: record.name,
      symbol: record.symbol,
      decimals: record.decimals,
      multiplier: record.multiplier,
      raw: record,
    };

    if (record.convertible !== undefined) {
      currency.convertible = parseCurrencyConvertible(record.convertible, index);
    }

    currencies.push(currency);
  }

  return currencies;
}

function parsePaymentOptions(raw: unknown): PaymentOption[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const paymentOptions: PaymentOption[] = [];
  const seenIds = new Set<string>();

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

    if (seenIds.has(record.id)) {
      throw new InvalidPaymentOptionError(`paymentOptions contains duplicate id: ${record.id}`);
    }
    seenIds.add(record.id);

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

    if (record.currencies !== undefined) {
      const optionCurrencies = parseCurrencies(record.currencies);
      if (optionCurrencies) {
        option.currencies = optionCurrencies;
      }
    }

    paymentOptions.push(option);
  }

  return paymentOptions;
}

export function parsePayRequestResponse(
  raw: unknown,
  context: ParsePayRequestContext = {},
): PayRequest {
  const parsed = payRequestSchema.safeParse(raw);

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

  const payRequest: PayRequest = {
    tag: "payRequest",
    callback: parsed.data.callback,
    minSendableMsat,
    maxSendableMsat,
    metadata,
    metadataRaw: parsed.data.metadata,
    metadataHash: getMetadataHash(parsed.data.metadata),
    raw,
  };

  payRequest.description = description;

  const image = getImage(metadata);
  if (image) {
    payRequest.image = image;
  }

  if (parsed.data.commentAllowed !== undefined) {
    payRequest.commentAllowed = parsed.data.commentAllowed;
  }

  const payerData = parsePayerData(parsed.data.payerData);
  if (payerData) {
    payRequest.payerData = payerData;
  }

  const paymentOptions = parsePaymentOptions(parsed.data.paymentOptions);
  if (paymentOptions) {
    payRequest.paymentOptions = paymentOptions;
  }

  const currencies = parseCurrencies(parsed.data.currencies);
  if (currencies) {
    payRequest.currencies = currencies;
  }

  if (context.sourceUrl) {
    payRequest.sourceUrl = context.sourceUrl;
  }

  if (context.lightningAddress) {
    payRequest.lightningAddress = context.lightningAddress;
  }

  return payRequest;
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
