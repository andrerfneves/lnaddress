import {
  AmountOutOfRangeError,
  CommentNotAllowedError,
  CommentTooLongError,
  InvalidCallbackResponseError,
  InvalidPaymentOptionError,
  MissingMandatoryPayerDataError,
  NetworkError,
} from "../core/errors";
import type {
  Bolt11PaymentInstruction,
  DestinationPaymentInstruction,
  NodePubkeyVerification,
  PayRequest,
  PaymentInstruction,
  RequestPaymentOptions,
  ResolveOptions,
} from "../core/types";
import { verifyNodePubkeys } from "../extensions/node-pubkeys";
import { parseSuccessAction } from "../extensions/success-action";
import {
  callbackAmountValue,
  parsePaymentQuote,
  paymentQuoteRequired,
  validatePaymentQuoteRequest,
  validateUnit,
} from "../extensions/units";
import { assertBolt11Payment } from "../lightning/bolt11";
import {
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
} from "../utils/internal";
import { isPayRequest } from "./payrequest";
import { assertProviderPolicy } from "./provider-policy";
import { resolve } from "./resolve";

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

function readVerifyUrl(
  raw: Record<string, unknown>,
  options: RequestPaymentOptions,
): string | undefined {
  const verifyUrl = readString(raw, ["verify", "verifyUrl"]);
  if (!verifyUrl) {
    return undefined;
  }

  try {
    return assertHttpUrl(verifyUrl, options).toString();
  } catch (cause) {
    throw new InvalidCallbackResponseError("Payment callback verify URL is invalid", { cause });
  }
}

function stringifyPayerData(payerData: Record<string, unknown>): string {
  try {
    return JSON.stringify(payerData);
  } catch (cause) {
    throw new InvalidCallbackResponseError("payerData must be JSON serializable", { cause });
  }
}

function validateCallbackRequest(payRequest: PayRequest, options: RequestPaymentOptions): void {
  const amountMsatProvided = options.amountMsat !== undefined;
  const unitAmountProvided = options.unitAmount !== undefined;

  if (amountMsatProvided && unitAmountProvided) {
    throw new AmountOutOfRangeError("amountMsat and unitAmount are mutually exclusive");
  }

  if (!amountMsatProvided && !unitAmountProvided) {
    throw new AmountOutOfRangeError("amountMsat or unitAmount is required");
  }

  if (amountMsatProvided) {
    validateCallbackAmount(
      payRequest,
      options.amountMsat as number | bigint,
      options.paymentOption,
    );
  }

  if (unitAmountProvided) {
    validateUnit(payRequest, options.unitAmount?.unit, options.paymentOption, {
      amount: options.unitAmount?.amount,
    });
  }

  validateUnit(payRequest, options.receiveUnit, options.paymentOption);
}

function validateCallbackStatus(record: Record<string, unknown>): void {
  const status = record.status;
  if (status === undefined) {
    return;
  }

  if (status === "ERROR") {
    throw new InvalidCallbackResponseError(callbackErrorMessage(record));
  }

  if (status !== "OK") {
    throw new InvalidCallbackResponseError("Payment callback status must be OK or ERROR");
  }
}

function validateCallbackPaymentOption(
  payRequest: PayRequest,
  requestedPaymentOption: string | undefined,
  returnedPaymentOption: string | undefined,
): void {
  if (returnedPaymentOption === undefined) {
    return;
  }

  if (requestedPaymentOption !== undefined && returnedPaymentOption !== requestedPaymentOption) {
    throw new InvalidCallbackResponseError(
      `Payment callback paymentOption ${returnedPaymentOption} does not match requested paymentOption ${requestedPaymentOption}`,
    );
  }

  try {
    validatePaymentOption(payRequest, returnedPaymentOption);
  } catch (cause) {
    throw new InvalidCallbackResponseError("Payment callback paymentOption is not advertised", {
      cause,
    });
  }
}

function selectedPaymentOptionType(
  payRequest: PayRequest,
  requestedPaymentOption: string | undefined,
  returnedPaymentOption: string | undefined,
): string | undefined {
  const selectedId = returnedPaymentOption ?? requestedPaymentOption;
  if (selectedId === undefined) {
    return undefined;
  }

  return payRequest.paymentOptions?.find((option) => option.id === selectedId)?.type;
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

  validateCallbackStatus(record);

  const pr = readString(record, ["pr"]);
  const routes = readUnknown(record, ["routes"]);
  const paymentDestination = readString(record, ["paymentDestination"]);
  const paymentUri = readString(record, ["paymentURI", "paymentUri"]);
  const paymentOption = readString(record, ["paymentOption"]);
  validateCallbackPaymentOption(payRequest, options.paymentOption, paymentOption);
  const paymentOptionType = selectedPaymentOptionType(
    payRequest,
    options.paymentOption,
    paymentOption,
  );

  const paymentQuote = parsePaymentQuote(
    readUnknown(record, ["paymentQuote"]),
    paymentQuoteRequired(options),
  );
  validatePaymentQuoteRequest(paymentQuote, options);

  const verifyUrl = readVerifyUrl(record, options);
  if (verifyUrl) {
    assertProviderPolicy(payRequest, verifyUrl, options, "Payment callback verify URL");
  }
  const successAction = parseSuccessAction(readUnknown(record, ["successAction"]), options);

  if (pr) {
    let nodePubkeyVerification: NodePubkeyVerification | undefined;
    if (options.validateBolt11 ?? true) {
      const bolt11 = await assertBolt11Payment(pr, payRequest, options, paymentQuote);
      nodePubkeyVerification = verifyNodePubkeys(payRequest, bolt11, options.nodePubkeyPolicy);
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

    if (paymentQuote) {
      instruction.paymentQuote = paymentQuote;
    }

    if (verifyUrl) {
      instruction.verifyUrl = verifyUrl;
    }

    if (successAction) {
      instruction.successAction = successAction;
    }

    if (nodePubkeyVerification) {
      instruction.nodePubkeyVerification = nodePubkeyVerification;
    }

    return instruction;
  }

  if (paymentOptionType === "lightning") {
    throw new InvalidCallbackResponseError(
      'Payment callback response for paymentOption type "lightning" must include pr',
    );
  }

  if (paymentDestination || paymentUri) {
    const instruction: DestinationPaymentInstruction = paymentDestination
      ? {
          type: "destination",
          paymentDestination,
          ...(paymentUri ? { paymentUri } : {}),
          raw,
        }
      : {
          type: "destination",
          paymentUri: paymentUri as string,
          raw,
        };

    if (paymentOption) {
      instruction.paymentOption = paymentOption;
    }

    if (paymentQuote) {
      instruction.paymentQuote = paymentQuote;
    }

    if (verifyUrl) {
      instruction.verifyUrl = verifyUrl;
    }

    return instruction;
  }

  throw new InvalidCallbackResponseError(
    "Payment callback response must include pr, paymentDestination, or paymentURI",
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

  if (options.unitAmount !== undefined) {
    callbackUrl.searchParams.set("unit", options.unitAmount.unit);
  }

  if (options.receiveUnit !== undefined) {
    callbackUrl.searchParams.set("receiveUnit", options.receiveUnit);
  }

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
  validateCallbackRequest(payRequest, options);
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
