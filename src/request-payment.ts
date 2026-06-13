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
  DestinationPaymentInstruction,
  PayRequest,
  PaymentInstruction,
  RequestPaymentOptions,
  ResolveOptions,
} from "./types";

export function validateCallbackAmount(
  pay_request: PayRequest,
  amountMsat: number | bigint,
  paymentOption?: string,
): void {
  let amount: bigint;

  try {
    amount = toMsatBigint(amountMsat, "amountMsat");
  } catch (cause) {
    throw new AmountOutOfRangeError("amountMsat must be a non-negative integer", { cause });
  }

  let minSendable = pay_request.minSendableMsat;
  let maxSendable = pay_request.maxSendableMsat;

  if (paymentOption !== undefined && pay_request.paymentOptions) {
    const option = pay_request.paymentOptions.find((o) => o.id === paymentOption);
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

export function validateComment(pay_request: PayRequest, comment?: string): void {
  if (comment === undefined) {
    return;
  }

  const allowed = pay_request.commentAllowed ?? 0;

  if (allowed <= 0) {
    throw new CommentNotAllowedError();
  }

  if (comment.length > allowed) {
    throw new CommentTooLongError(`Comment exceeds the allowed length of ${allowed} characters`);
  }
}

export function validateMandatoryPayerData(
  pay_request: PayRequest,
  payerData?: Record<string, unknown>,
): void {
  const requested = pay_request.payerData;
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

export function validatePaymentOption(pay_request: PayRequest, paymentOption?: string): void {
  if (paymentOption === undefined) {
    return;
  }

  const options = pay_request.paymentOptions;
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

function callbackErrorMessage(raw: Record<string, unknown>): string {
  const reason = readString(raw, ["reason", "message", "error"]);
  return reason
    ? `Payment callback returned an error: ${reason}`
    : "Payment callback returned an error";
}

function readVerifyUrl(raw: Record<string, unknown>): string | undefined {
  const verifyUrl = readString(raw, ["verify", "verifyUrl", "verifyUrl"]);
  if (!verifyUrl) {
    return undefined;
  }

  try {
    return assertHttpUrl(verifyUrl).toString();
  } catch (cause) {
    throw new InvalidCallbackResponseError("Payment callback verify URL is invalid", { cause });
  }
}

function sameSite(hostname: string, expected_hostname: string): boolean {
  return hostname === expected_hostname || hostname.endsWith(`.${expected_hostname}`);
}

function providerBase(pay_request: PayRequest): URL | undefined {
  if (pay_request.sourceUrl) {
    return new URL(pay_request.sourceUrl);
  }
  if (pay_request.lightningAddress) {
    return new URL(`https://${pay_request.lightningAddress.domain}`);
  }
  return undefined;
}

function assertProviderPolicy(
  pay_request: PayRequest,
  url: string | URL,
  options: RequestPaymentOptions,
  label: string,
): void {
  const policy = options.providerPolicy ?? "off";
  if (policy === "off") {
    return;
  }

  const base = providerBase(pay_request);
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

async function parseCallbackResponse(
  raw: unknown,
  pay_request: PayRequest,
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
  const verifyUrl = readVerifyUrl(record);
  if (verifyUrl) {
    assertProviderPolicy(pay_request, verifyUrl, options, "Payment callback verify URL");
  }
  const successAction = parseSuccessAction(readUnknown(record, ["successAction"]));

  if (pr) {
    if (options.validateBolt11 ?? true) {
      await assertBolt11Payment(pr, pay_request, options);
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

    return instruction;
  }

  throw new InvalidCallbackResponseError(
    "Payment callback response must include pr or paymentDestination",
  );
}

function buildCallbackUrl(pay_request: PayRequest, options: RequestPaymentOptions): URL {
  let callback_url: URL;

  try {
    callback_url = assertHttpUrl(pay_request.callback, options);
  } catch (cause) {
    throw new InvalidCallbackResponseError("Pay request callback URL is invalid", { cause });
  }

  callback_url.searchParams.set("amount", amountToMsatString(options.amountMsat));

  if (options.comment !== undefined) {
    callback_url.searchParams.set("comment", options.comment);
  }

  if (options.payerData !== undefined) {
    callback_url.searchParams.set("payerdata", stringifyPayerData(options.payerData));
  }

  if (options.paymentOption !== undefined) {
    callback_url.searchParams.set("paymentOption", options.paymentOption);
  }

  return callback_url;
}

export async function requestPayment(
  pay_request_or_input: PayRequest | string,
  options: RequestPaymentOptions,
): Promise<PaymentInstruction> {
  const resolve_options: ResolveOptions = {};
  if (options.fetch) {
    resolve_options.fetch = options.fetch;
  }
  if (options.headers) {
    resolve_options.headers = options.headers;
  }
  if (options.allowOnion !== undefined) {
    resolve_options.allowOnion = options.allowOnion;
  }

  const pay_request = isPayRequest(pay_request_or_input)
    ? pay_request_or_input
    : await resolve(pay_request_or_input, resolve_options);

  validateCallbackAmount(pay_request, options.amountMsat, options.paymentOption);
  validateComment(pay_request, options.comment);
  validateMandatoryPayerData(pay_request, options.payerData);
  validatePaymentOption(pay_request, options.paymentOption);

  const callback_url = buildCallbackUrl(pay_request, options);
  assertProviderPolicy(pay_request, callback_url, options, "Pay request callback URL");
  const fetcher = getFetch(options.fetch);
  let response: Response;
  const { init, cleanup } = requestInit(options.headers, options);

  try {
    response = await fetcher(callback_url, init);
  } catch (cause) {
    throw new NetworkError(`Failed to request payment instruction: ${callback_url.toString()}`, {
      cause,
    });
  } finally {
    cleanup();
  }

  assertRedirectPolicy(callback_url, response, options);

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

  return parseCallbackResponse(raw, pay_request, options);
}

export async function pay(
  input: string,
  options: RequestPaymentOptions,
): Promise<PaymentInstruction> {
  return requestPayment(input, options);
}
