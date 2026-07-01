import {
  AmountOutOfRangeError,
  InvalidCallbackResponseError,
  InvalidPayRequestError,
  InvalidRequestPaymentOptionsError,
} from "../core/errors";
import type {
  PayRequest,
  PaymentQuote,
  PaymentQuoteAmount,
  PaymentQuoteFee,
  PaymentUnit,
  RequestPaymentOptions,
} from "../core/types";
import { amountToMsatString, unknownToRecord } from "../utils/internal";

export type UnitValidationOptions = {
  amount?: number | bigint;
};

function assertUnitCode(code: string, label: string, ErrorType = InvalidPayRequestError): void {
  if (code.length === 0 || code.trim() !== code || /\s/.test(code) || code.includes(".")) {
    throw new ErrorType(`${label} must be a non-empty unit code without whitespace or '.'`);
  }
}

function assertWireUnitCode(code: string, label: string): void {
  assertUnitCode(code, label, InvalidCallbackResponseError);
}

function isIntegerString(value: string): boolean {
  return /^\d+$/.test(value);
}

function parseNonNegativeIntegerString(value: unknown, label: string): string {
  if (typeof value !== "string" || !isIntegerString(value)) {
    throw new InvalidPayRequestError(`${label} must be a non-negative integer string`);
  }
  return value;
}

function parsePositiveIntegerString(value: unknown, label: string): string {
  if (typeof value !== "string" || !isIntegerString(value) || BigInt(value) <= 0n) {
    throw new InvalidCallbackResponseError(`${label} must be a positive integer string`);
  }
  return value;
}

export function amountToPositiveIntegerString(amount: number | bigint, field: string): string {
  if (typeof amount === "bigint") {
    if (amount <= 0n) {
      throw new AmountOutOfRangeError(`${field} must be a positive integer`);
    }
    return amount.toString();
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AmountOutOfRangeError(`${field} must be a positive safe integer`);
  }

  return String(amount);
}

export function parseUnits(raw: unknown, label = "units"): PaymentUnit[] | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!Array.isArray(raw)) {
    throw new InvalidPayRequestError(`${label} must be an array`);
  }

  const units: PaymentUnit[] = [];
  const seenCodes = new Set<string>();

  for (const [index, entry] of raw.entries()) {
    const entryLabel = `${label} entry ${index}`;
    const record = unknownToRecord(entry);
    if (!record) {
      throw new InvalidPayRequestError(`${entryLabel} must be an object`);
    }

    if (typeof record.code !== "string") {
      throw new InvalidPayRequestError(`${entryLabel} must have a string code`);
    }
    assertUnitCode(record.code, `${entryLabel} code`);

    if (
      typeof record.decimals !== "number" ||
      !Number.isSafeInteger(record.decimals) ||
      record.decimals < 0
    ) {
      throw new InvalidPayRequestError(
        `${entryLabel} must have non-negative safe integer decimals`,
      );
    }

    if (seenCodes.has(record.code)) {
      throw new InvalidPayRequestError(`${label} contains duplicate unit code: ${record.code}`);
    }
    seenCodes.add(record.code);

    const unit: PaymentUnit = {
      code: record.code,
      decimals: record.decimals,
      raw: record,
    };

    for (const key of ["name", "symbol", "assetId"] as const) {
      const value = record[key];
      if (value !== undefined) {
        if (typeof value !== "string") {
          throw new InvalidPayRequestError(`${entryLabel} ${key} must be a string`);
        }
        unit[key] = value;
      }
    }

    if (record.minAmount !== undefined) {
      unit.minAmount = parseNonNegativeIntegerString(record.minAmount, `${entryLabel} minAmount`);
    }
    if (record.maxAmount !== undefined) {
      unit.maxAmount = parseNonNegativeIntegerString(record.maxAmount, `${entryLabel} maxAmount`);
    }
    if (
      unit.minAmount !== undefined &&
      unit.maxAmount !== undefined &&
      BigInt(unit.minAmount) > BigInt(unit.maxAmount)
    ) {
      throw new InvalidPayRequestError(
        `${entryLabel} minAmount must be less than or equal to maxAmount`,
      );
    }

    units.push(unit);
  }

  return units;
}

export function effectiveUnits(
  payRequest: PayRequest,
  paymentOption?: string,
): PaymentUnit[] | undefined {
  if (paymentOption !== undefined && payRequest.paymentOptions) {
    const option = payRequest.paymentOptions.find((candidate) => candidate.id === paymentOption);
    if (option?.units) {
      return option.units;
    }
  }

  return payRequest.units;
}

export function findEffectiveUnit(
  payRequest: PayRequest,
  unit: string,
  paymentOption?: string,
): PaymentUnit | undefined {
  return effectiveUnits(payRequest, paymentOption)?.find((candidate) => candidate.code === unit);
}

export function validateUnit(
  payRequest: PayRequest,
  unit?: string,
  paymentOption?: string,
  options: UnitValidationOptions = {},
): void {
  if (unit === undefined) {
    return;
  }

  assertUnitCode(unit, "unit", InvalidRequestPaymentOptionsError);

  const units = effectiveUnits(payRequest, paymentOption);
  if (!units) {
    throw new InvalidRequestPaymentOptionsError("Pay request does not support units");
  }

  const match = findEffectiveUnit(payRequest, unit, paymentOption);
  if (!match) {
    const scope = paymentOption === undefined ? "pay request" : `paymentOption ${paymentOption}`;
    throw new InvalidRequestPaymentOptionsError(`Unit ${unit} is not available for ${scope}`);
  }

  if (options.amount === undefined) {
    return;
  }

  const amount = BigInt(amountToPositiveIntegerString(options.amount, "unitAmount.amount"));
  if (match.minAmount !== undefined && amount < BigInt(match.minAmount)) {
    throw new InvalidRequestPaymentOptionsError(
      `unitAmount.amount must be at least ${match.minAmount} for unit ${unit}`,
    );
  }
  if (match.maxAmount !== undefined && amount > BigInt(match.maxAmount)) {
    throw new InvalidRequestPaymentOptionsError(
      `unitAmount.amount must be at most ${match.maxAmount} for unit ${unit}`,
    );
  }
}

export function callbackAmountValue(options: RequestPaymentOptions): string {
  if (options.unitAmount !== undefined) {
    assertUnitCode(options.unitAmount.unit, "unitAmount.unit", InvalidRequestPaymentOptionsError);
    return amountToPositiveIntegerString(options.unitAmount.amount, "unitAmount.amount");
  }

  if (options.amountMsat === undefined) {
    throw new AmountOutOfRangeError("amountMsat or unitAmount is required");
  }

  return amountToMsatString(options.amountMsat);
}

export function requestedQuoteUnit(options: RequestPaymentOptions): string {
  return options.unitAmount?.unit ?? "msat";
}

export function paymentQuoteRequired(options: RequestPaymentOptions): boolean {
  return options.unitAmount !== undefined || options.receiveUnit !== undefined;
}

function parseQuoteAmount(raw: unknown, label: string): PaymentQuoteAmount {
  const record = unknownToRecord(raw);
  if (!record) {
    throw new InvalidCallbackResponseError(`${label} must be an object`);
  }

  const amount = parsePositiveIntegerString(record.amount, `${label}.amount`);
  if (typeof record.unit !== "string") {
    throw new InvalidCallbackResponseError(`${label}.unit must be a string`);
  }
  assertWireUnitCode(record.unit, `${label}.unit`);

  return { amount, unit: record.unit, raw: record };
}

function parseQuoteFee(raw: unknown, index: number): PaymentQuoteFee {
  const record = unknownToRecord(raw);
  if (!record) {
    throw new InvalidCallbackResponseError(`paymentQuote.fees entry ${index} must be an object`);
  }

  const amount = parsePositiveIntegerString(record.amount, `paymentQuote.fees[${index}].amount`);
  if (typeof record.unit !== "string") {
    throw new InvalidCallbackResponseError(`paymentQuote.fees[${index}].unit must be a string`);
  }
  assertWireUnitCode(record.unit, `paymentQuote.fees[${index}].unit`);

  const fee: PaymentQuoteFee = { amount, unit: record.unit, raw: record };
  if (record.description !== undefined) {
    if (typeof record.description !== "string") {
      throw new InvalidCallbackResponseError(
        `paymentQuote.fees[${index}].description must be a string`,
      );
    }
    fee.description = record.description;
  }

  return fee;
}

export function parsePaymentQuote(raw: unknown, required = false): PaymentQuote | undefined {
  if (raw === undefined || raw === null) {
    if (required) {
      throw new InvalidCallbackResponseError(
        "Payment callback response must include paymentQuote when unit or receiveUnit is requested",
      );
    }
    return undefined;
  }

  const record = unknownToRecord(raw);
  if (!record) {
    throw new InvalidCallbackResponseError("paymentQuote must be an object");
  }

  const quote: PaymentQuote = {
    requested: parseQuoteAmount(record.requested, "paymentQuote.requested"),
    payment: parseQuoteAmount(record.payment, "paymentQuote.payment"),
    raw: record,
  };

  if (record.id !== undefined) {
    if (typeof record.id !== "string") {
      throw new InvalidCallbackResponseError("paymentQuote.id must be a string");
    }
    quote.id = record.id;
  }

  if (record.expiresAt !== undefined) {
    if (typeof record.expiresAt !== "string") {
      throw new InvalidCallbackResponseError("paymentQuote.expiresAt must be a string");
    }
    quote.expiresAt = record.expiresAt;
  }

  if (record.receive !== undefined) {
    quote.receive = parseQuoteAmount(record.receive, "paymentQuote.receive");
  }

  if (record.fees !== undefined) {
    if (!Array.isArray(record.fees)) {
      throw new InvalidCallbackResponseError("paymentQuote.fees must be an array");
    }
    quote.fees = record.fees.map((fee, index) => parseQuoteFee(fee, index));
  }

  return quote;
}

export function validatePaymentQuoteRequest(
  paymentQuote: PaymentQuote | undefined,
  options: RequestPaymentOptions,
): void {
  if (!paymentQuote) {
    return;
  }

  const expectedAmount = callbackAmountValue(options);
  const expectedUnit = requestedQuoteUnit(options);
  if (
    paymentQuote.requested.amount !== expectedAmount ||
    paymentQuote.requested.unit !== expectedUnit
  ) {
    throw new InvalidCallbackResponseError(
      `paymentQuote.requested must match requested ${expectedAmount} ${expectedUnit}`,
    );
  }

  if (options.receiveUnit !== undefined) {
    if (!paymentQuote.receive) {
      throw new InvalidCallbackResponseError(
        `paymentQuote.receive must be present when receiveUnit ${options.receiveUnit} is requested`,
      );
    }

    if (paymentQuote.receive.unit !== options.receiveUnit) {
      throw new InvalidCallbackResponseError(
        `paymentQuote.receive.unit must match requested receiveUnit ${options.receiveUnit}`,
      );
    }
  }
}
