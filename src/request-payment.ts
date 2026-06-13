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
  const verifyUrl = readVerifyUrl(record);
  if (verifyUrl) {
    assertProviderPolicy(payRequest, verifyUrl, options, "Payment callback verify URL");
  }
  const successAction = parseSuccessAction(readUnknown(record, ["successAction"]));

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

function buildCallbackUrl(payRequest: PayRequest, options: RequestPaymentOptions): URL {
  let callbackUrl: URL;

  try {
    callbackUrl = assertHttpUrl(payRequest.callback, options);
  } catch (cause) {
    throw new InvalidCallbackResponseError("Pay request callback URL is invalid", { cause });
  }

  callbackUrl.searchParams.set("amount", amountToMsatString(options.amountMsat));

  if (options.comment !== undefined) {
    callbackUrl.searchParams.set("comment", options.comment);
  }

  if (options.payerData !== undefined) {
    callbackUrl.searchParams.set("payerdata", stringifyPayerData(options.payerData));
  }

  if (options.paymentOption !== undefined) {
    callbackUrl.searchParams.set("paymentOption", options.paymentOption);
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

  const payRequest = isPayRequest(payRequestOrInput)
    ? payRequestOrInput
    : await resolve(payRequestOrInput, resolveOptions);

  validateCallbackAmount(payRequest, options.amountMsat, options.paymentOption);
  validateComment(payRequest, options.comment);
  validateMandatoryPayerData(payRequest, options.payerData);
  validatePaymentOption(payRequest, options.paymentOption);

  const callbackUrl = buildCallbackUrl(payRequest, options);
  assertProviderPolicy(payRequest, callbackUrl, options, "Pay request callback URL");
  const fetcher = getFetch(options.fetch);
  let response: Response;
  const { init, cleanup } = requestInit(options.headers, options);

  try {
    response = await fetcher(callbackUrl, init);
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
