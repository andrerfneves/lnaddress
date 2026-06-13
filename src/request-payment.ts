import { assertBolt11Payment } from "./bolt11";
import {
  AmountOutOfRangeError,
  CommentNotAllowedError,
  CommentTooLongError,
  InvalidCallbackResponseError,
  InvalidPaymentOptionError,
  MissingMandatoryPayerDataError,
  NetworkError,
} from "./errors";
import {
  amountToMsatString,
  assertHttpUrl,
  assertRedirectPolicy,
  fetchWithRedirectPolicy,
  getFetch,
  readJsonResponse,
  readString,
  readUnknown,
  requestInit,
  toMsatBigint,
  unknownToRecord,
} from "./internal";
import { isPayRequest } from "./payrequest";
import { resolve } from "./resolve";
import { parseSuccessAction } from "./success-action";
import type {
  Bolt11PaymentInstruction,
  ConvertedAmount,
  Currency,
  DestinationPaymentInstruction,
  PayRequest,
  PaymentInstruction,
  RequestPaymentOptions,
  ResolveOptions,
} from "./types";

export function validateCallbackAmount(
  payRequest: PayRequest,
  amountMsat: number | bigint,
  paymentOption?: string,
): void {
  let amount: bigint;

  try {
    amount = toMsatBigint(amountMsat, "amountMsat");
  } catch (cause) {
    throw new AmountOutOfRangeError("amountMsat must be a non-negative integer", { cause });
  }

  let minSendable = payRequest.minSendableMsat;
  let maxSendable = payRequest.maxSendableMsat;

  if (paymentOption !== undefined && payRequest.paymentOptions) {
    const option = payRequest.paymentOptions.find((o) => o.id === paymentOption);
    if (option) {
      if (option.minSendableMsat !== undefined) {
        minSendable = option.minSendableMsat;
      }
      if (option.maxSendableMsat !== undefined) {
        maxSendable = option.maxSendableMsat;
      }
    }
  }

  if (amount < minSendable || amount > maxSendable) {
    throw new AmountOutOfRangeError(
      `amountMsat must be between ${minSendable.toString()} and ${maxSendable.toString()}`,
    );
  }
}

export function validateComment(payRequest: PayRequest, comment?: string): void {
  if (comment === undefined) {
    return;
  }

  const allowed = payRequest.commentAllowed ?? 0;

  if (allowed <= 0) {
    throw new CommentNotAllowedError();
  }

  if (comment.length > allowed) {
    throw new CommentTooLongError(`Comment exceeds the allowed length of ${allowed} characters`);
  }
}

export function validateMandatoryPayerData(
  payRequest: PayRequest,
  payerData?: Record<string, unknown>,
): void {
  const requested = payRequest.payerData;
  if (!requested) {
    return;
  }

  const missing = Object.entries(requested)
    .filter(
      ([field, config]) =>
        config.mandatory === true &&
        (payerData?.[field] === undefined || payerData[field] === null),
    )
    .map(([field]) => field);

  if (missing.length > 0) {
    throw new MissingMandatoryPayerDataError(missing);
  }
}

export function validatePaymentOption(payRequest: PayRequest, paymentOption?: string): void {
  if (paymentOption === undefined) {
    return;
  }

  const options = payRequest.paymentOptions;
  if (!options) {
    throw new InvalidPaymentOptionError(
      "paymentOption was provided but the pay request does not advertise paymentOptions",
    );
  }

  const match = options.find((o) => o.id === paymentOption);
  if (!match) {
    throw new InvalidPaymentOptionError(
      `paymentOption "${paymentOption}" is not in the advertised paymentOptions`,
    );
  }

  if (match.available === false) {
    throw new InvalidPaymentOptionError(
      `paymentOption "${paymentOption}" is currently unavailable`,
    );
  }
}

type CurrencyValidationOptions = {
  requireConvertible?: boolean;
};

function effectiveCurrencies(
  payRequest: PayRequest,
  paymentOption?: string,
): Currency[] | undefined {
  if (paymentOption !== undefined && payRequest.paymentOptions) {
    const option = payRequest.paymentOptions.find((candidate) => candidate.id === paymentOption);
    if (option?.currencies) {
      return option.currencies;
    }
  }

  return payRequest.currencies;
}

export function validateCurrency(
  payRequest: PayRequest,
  currency?: string,
  paymentOption?: string,
  options: CurrencyValidationOptions = {},
): void {
  if (currency === undefined) {
    return;
  }

  const currencies = effectiveCurrencies(payRequest, paymentOption);
  if (!currencies) {
    throw new InvalidCallbackResponseError("Pay request does not support currencies");
  }

  const match = currencies.find((candidate) => candidate.code === currency);
  if (!match) {
    const scope = paymentOption === undefined ? "pay request" : `paymentOption ${paymentOption}`;
    throw new InvalidCallbackResponseError(`Currency ${currency} is not available for ${scope}`);
  }

  if (options.requireConvertible && !match.convertible) {
    throw new InvalidCallbackResponseError(`Currency ${currency} is not convertible`);
  }
}

function callbackErrorMessage(raw: Record<string, unknown>): string {
  const reason = readString(raw, ["reason", "message", "error"]);
  return reason
    ? `Payment callback returned an error: ${reason}`
    : "Payment callback returned an error";
}

function readVerifyUrl(
  raw: Record<string, unknown>,
  options: RequestPaymentOptions,
): string | undefined {
  const verifyUrl = readString(raw, ["verify", "verifyUrl", "verifyUrl"]);
  if (!verifyUrl) {
    return undefined;
  }

  try {
    return assertHttpUrl(verifyUrl, options).toString();
  } catch (cause) {
    throw new InvalidCallbackResponseError("Payment callback verify URL is invalid", { cause });
  }
}

function sameSite(hostname: string, expectedHostname: string): boolean {
  return hostname === expectedHostname || hostname.endsWith(`.${expectedHostname}`);
}

function providerBase(payRequest: PayRequest): URL | undefined {
  if (payRequest.sourceUrl) {
    return new URL(payRequest.sourceUrl);
  }
  if (payRequest.lightningAddress) {
    return new URL(`https://${payRequest.lightningAddress.domain}`);
  }
  return undefined;
}

function assertProviderPolicy(
  payRequest: PayRequest,
  url: string | URL,
  options: RequestPaymentOptions,
  label: string,
): void {
  const policy = options.providerPolicy ?? "off";
  if (policy === "off") {
    return;
  }

  const base = providerBase(payRequest);
  if (!base) {
    throw new InvalidCallbackResponseError(
      `${label} providerPolicy requires a resolved PayRequest with sourceUrl or lightningAddress`,
    );
  }

  const parsed = typeof url === "string" ? new URL(url) : url;
  if (policy === "same-origin" && parsed.origin !== base.origin) {
    throw new InvalidCallbackResponseError(`${label} does not match provider origin`);
  }

  if (policy === "same-site" && !sameSite(parsed.hostname, base.hostname)) {
    throw new InvalidCallbackResponseError(`${label} does not match provider site`);
  }
}

function stringifyPayerData(payerData: Record<string, unknown>): string {
  try {
    return JSON.stringify(payerData);
  } catch (cause) {
    throw new InvalidCallbackResponseError("payerData must be JSON serializable", { cause });
  }
}

function amountToPositiveIntegerString(amount: number | bigint, field: string): string {
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

function assertCurrencyCodeForAmount(currency: string): void {
  if (currency.length === 0 || currency.includes(".")) {
    throw new InvalidCallbackResponseError(
      "denominatedAmount.currency must be a non-empty currency code without '.'",
    );
  }
}

function callbackAmountValue(options: RequestPaymentOptions): string {
  if (options.denominatedAmount !== undefined) {
    assertCurrencyCodeForAmount(options.denominatedAmount.currency);
    const amount = amountToPositiveIntegerString(
      options.denominatedAmount.amount,
      "denominatedAmount.amount",
    );
    return `${amount}.${options.denominatedAmount.currency}`;
  }

  if (options.amountMsat === undefined) {
    throw new AmountOutOfRangeError("amountMsat or denominatedAmount is required");
  }

  return amountToMsatString(options.amountMsat);
}

function validateCurrencyRequest(payRequest: PayRequest, options: RequestPaymentOptions): void {
  const amountMsat = options.amountMsat;
  const denominatedAmount = options.denominatedAmount;
  const amountMsatProvided = amountMsat !== undefined;
  const denominatedAmountProvided = denominatedAmount !== undefined;

  if (amountMsatProvided && denominatedAmountProvided) {
    throw new AmountOutOfRangeError("amountMsat and denominatedAmount are mutually exclusive");
  }

  if (!amountMsatProvided && !denominatedAmountProvided) {
    throw new AmountOutOfRangeError("amountMsat or denominatedAmount is required");
  }

  if (amountMsat !== undefined) {
    validateCallbackAmount(payRequest, amountMsat, options.paymentOption);
  }

  if (denominatedAmount !== undefined) {
    amountToPositiveIntegerString(denominatedAmount.amount, "denominatedAmount.amount");
    assertCurrencyCodeForAmount(denominatedAmount.currency);
    validateCurrency(payRequest, denominatedAmount.currency, options.paymentOption);
  }

  validateCurrency(payRequest, options.convert, options.paymentOption, {
    requireConvertible: options.convert !== undefined,
  });
}

function parseConvertedInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidCallbackResponseError(`${field} must be a non-negative safe integer`);
  }

  return value;
}

function parseConvertedAmount(raw: unknown, required: boolean): ConvertedAmount | undefined {
  if (raw === undefined || raw === null) {
    if (required) {
      throw new InvalidCallbackResponseError(
        "Payment callback response must include converted when convert is requested",
      );
    }
    return undefined;
  }

  const record = unknownToRecord(raw);
  if (!record) {
    throw new InvalidCallbackResponseError("converted must be an object");
  }

  const multiplier = record.multiplier;
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier <= 0) {
    throw new InvalidCallbackResponseError("converted.multiplier must be a positive number");
  }

  const amount = parseConvertedInteger(record.amount, "converted.amount");
  const fee = parseConvertedInteger(record.fee, "converted.fee");

  return { multiplier, amount, fee, raw: record };
}

async function parseCallbackResponse(
  raw: unknown,
  payRequest: PayRequest,
  options: RequestPaymentOptions,
): Promise<PaymentInstruction> {
  const record = unknownToRecord(raw);
  if (!record) {
    throw new InvalidCallbackResponseError("Payment callback response must be an object");
  }

  if (record.status === "ERROR") {
    throw new InvalidCallbackResponseError(callbackErrorMessage(record));
  }

  const pr = readString(record, ["pr"]);
  const routes = readUnknown(record, ["routes"]);
  const paymentDestination = readString(record, ["paymentDestination"]);
  const paymentUri = readString(record, ["paymentURI", "paymentUri"]);
  const paymentOption = readString(record, ["paymentOption"]);
  const converted = parseConvertedAmount(
    readUnknown(record, ["converted"]),
    options.convert !== undefined,
  );
  const verifyUrl = readVerifyUrl(record, options);
  if (verifyUrl) {
    assertProviderPolicy(payRequest, verifyUrl, options, "Payment callback verify URL");
  }
  const successAction = parseSuccessAction(readUnknown(record, ["successAction"]), options);

  if (pr) {
    if (options.validateBolt11 ?? true) {
      await assertBolt11Payment(pr, payRequest, options);
    }

    const instruction: Bolt11PaymentInstruction = {
      type: "bolt11",
      pr,
      raw,
    };

    if (Array.isArray(routes)) {
      instruction.routes = routes as [];
    }

    if (paymentOption) {
      instruction.paymentOption = paymentOption;
    }

    if (paymentDestination) {
      instruction.paymentDestination = paymentDestination;
    }

    if (paymentUri) {
      instruction.paymentUri = paymentUri;
    }

    if (verifyUrl) {
      instruction.verifyUrl = verifyUrl;
    }

    if (successAction) {
      instruction.successAction = successAction;
    }

    if (converted) {
      instruction.converted = converted;
    }

    return instruction;
  }

  if (paymentDestination) {
    const instruction: DestinationPaymentInstruction = {
      type: "destination",
      paymentDestination,
      raw,
    };

    if (paymentOption) {
      instruction.paymentOption = paymentOption;
    }

    if (paymentUri) {
      instruction.paymentUri = paymentUri;
    }

    if (verifyUrl) {
      instruction.verifyUrl = verifyUrl;
    }

    if (converted) {
      instruction.converted = converted;
    }

    return instruction;
  }

  throw new InvalidCallbackResponseError(
    "Payment callback response must include pr or paymentDestination",
  );
}

function buildCallbackUrl(payRequest: PayRequest, options: RequestPaymentOptions): URL {
  let callbackUrl: URL;

  try {
    callbackUrl = assertHttpUrl(payRequest.callback, options);
  } catch (cause) {
    throw new InvalidCallbackResponseError("Pay request callback URL is invalid", { cause });
  }

  callbackUrl.searchParams.set("amount", callbackAmountValue(options));

  if (options.comment !== undefined) {
    callbackUrl.searchParams.set("comment", options.comment);
  }

  if (options.payerData !== undefined) {
    callbackUrl.searchParams.set("payerdata", stringifyPayerData(options.payerData));
  }

  if (options.paymentOption !== undefined) {
    callbackUrl.searchParams.set("paymentOption", options.paymentOption);
  }

  if (options.convert !== undefined) {
    callbackUrl.searchParams.set("convert", options.convert);
  }

  return callbackUrl;
}

export async function requestPayment(
  payRequestOrInput: PayRequest | string,
  options: RequestPaymentOptions,
): Promise<PaymentInstruction> {
  const resolveOptions: ResolveOptions = {};
  if (options.fetch) {
    resolveOptions.fetch = options.fetch;
  }
  if (options.headers) {
    resolveOptions.headers = options.headers;
  }
  if (options.allowOnion !== undefined) {
    resolveOptions.allowOnion = options.allowOnion;
  }
  if (options.allowPrivateNetwork !== undefined) {
    resolveOptions.allowPrivateNetwork = options.allowPrivateNetwork;
  }
  if (options.signal !== undefined) {
    resolveOptions.signal = options.signal;
  }
  if (options.timeoutMs !== undefined) {
    resolveOptions.timeoutMs = options.timeoutMs;
  }
  if (options.redirectPolicy !== undefined) {
    resolveOptions.redirectPolicy = options.redirectPolicy;
  }

  const payRequest = isPayRequest(payRequestOrInput)
    ? payRequestOrInput
    : await resolve(payRequestOrInput, resolveOptions);

  validatePaymentOption(payRequest, options.paymentOption);
  validateCurrencyRequest(payRequest, options);
  validateComment(payRequest, options.comment);
  validateMandatoryPayerData(payRequest, options.payerData);

  const callbackUrl = buildCallbackUrl(payRequest, options);
  assertProviderPolicy(payRequest, callbackUrl, options, "Pay request callback URL");
  const fetcher = getFetch(options.fetch);
  let response: Response;
  const { init, cleanup } = requestInit(options.headers, options);

  try {
    response = await fetchWithRedirectPolicy(fetcher, callbackUrl, init, options);
  } catch (cause) {
    throw new NetworkError(`Failed to request payment instruction: ${callbackUrl.toString()}`, {
      cause,
    });
  } finally {
    cleanup();
  }

  assertRedirectPolicy(callbackUrl, response, options);

  if (!response.ok) {
    throw new NetworkError(
      `Failed to request payment instruction: ${response.status} ${response.statusText}`,
    );
  }

  let raw: unknown;
  try {
    raw = await readJsonResponse(response);
  } catch (cause) {
    throw new InvalidCallbackResponseError("Payment callback response is not valid JSON", {
      cause,
    });
  }

  return parseCallbackResponse(raw, payRequest, options);
}

export async function pay(
  input: string,
  options: RequestPaymentOptions,
): Promise<PaymentInstruction> {
  return requestPayment(input, options);
}
