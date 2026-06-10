import {
  AmountOutOfRangeError,
  CommentNotAllowedError,
  CommentTooLongError,
  InvalidCallbackResponseError,
  MissingMandatoryPayerDataError,
  NetworkError,
} from "./errors";
import {
  amount_to_msat_string,
  assert_http_url,
  get_fetch,
  merge_headers,
  read_json_response,
  read_string,
  read_unknown,
  to_msat_bigint,
  unknown_to_record,
} from "./internal";
import { is_pay_request } from "./payrequest";
import { resolve } from "./resolve";
import { parse_success_action } from "./success-action";
import type {
  Bolt11PaymentInstruction,
  DestinationPaymentInstruction,
  PayRequest,
  PaymentInstruction,
  RequestPaymentOptions,
  ResolveOptions,
} from "./types";

function assert_probably_bolt11(pr: string): void {
  if (!/^ln(bc|tb|bcrt|sb)[a-z0-9]+$/i.test(pr)) {
    throw new InvalidCallbackResponseError(
      "Callback response pr is not a valid-looking BOLT11 invoice",
    );
  }
}

export function validate_callback_amount(
  pay_request: PayRequest,
  amount_msat: number | bigint,
): void {
  let amount: bigint;

  try {
    amount = to_msat_bigint(amount_msat, "amount_msat");
  } catch (cause) {
    throw new AmountOutOfRangeError("amount_msat must be a non-negative integer", { cause });
  }

  if (amount < pay_request.min_sendable_msat || amount > pay_request.max_sendable_msat) {
    throw new AmountOutOfRangeError(
      `amount_msat must be between ${pay_request.min_sendable_msat.toString()} and ${pay_request.max_sendable_msat.toString()}`,
    );
  }
}

export function validate_comment(pay_request: PayRequest, comment?: string): void {
  if (comment === undefined) {
    return;
  }

  const allowed = pay_request.comment_allowed ?? 0;

  if (allowed <= 0) {
    throw new CommentNotAllowedError();
  }

  if (comment.length > allowed) {
    throw new CommentTooLongError(`Comment exceeds the allowed length of ${allowed} characters`);
  }
}

export function validate_mandatory_payer_data(
  pay_request: PayRequest,
  payer_data?: Record<string, unknown>,
): void {
  const requested = pay_request.payer_data;
  if (!requested) {
    return;
  }

  const missing = Object.entries(requested)
    .filter(([field, config]) => config.mandatory === true && payer_data?.[field] === undefined)
    .map(([field]) => field);

  if (missing.length > 0) {
    throw new MissingMandatoryPayerDataError(missing);
  }
}

function callback_error_message(raw: Record<string, unknown>): string {
  const reason = read_string(raw, ["reason", "message", "error"]);
  return reason
    ? `Payment callback returned an error: ${reason}`
    : "Payment callback returned an error";
}

function parse_callback_response(raw: unknown, validate_bolt11: boolean): PaymentInstruction {
  const record = unknown_to_record(raw);
  if (!record) {
    throw new InvalidCallbackResponseError("Payment callback response must be an object");
  }

  if (record.status === "ERROR") {
    throw new InvalidCallbackResponseError(callback_error_message(record));
  }

  const pr = read_string(record, ["pr"]);
  const routes = read_unknown(record, ["routes"]);
  const payment_destination = read_string(record, ["paymentDestination", "payment_destination"]);
  const payment_uri = read_string(record, ["paymentURI", "paymentUri", "payment_uri"]);
  const verify_url = read_string(record, ["verify", "verifyUrl", "verify_url"]);
  const success_action = parse_success_action(
    read_unknown(record, ["successAction", "success_action"]),
  );

  if (pr) {
    if (validate_bolt11) {
      assert_probably_bolt11(pr);
    }

    const instruction: Bolt11PaymentInstruction = {
      type: "bolt11",
      pr,
      raw,
    };

    if (Array.isArray(routes)) {
      instruction.routes = routes as [];
    }

    if (payment_destination) {
      instruction.payment_destination = payment_destination;
    }

    if (payment_uri) {
      instruction.payment_uri = payment_uri;
    }

    if (verify_url) {
      instruction.verify_url = verify_url;
    }

    if (success_action) {
      instruction.success_action = success_action;
    }

    return instruction;
  }

  if (payment_destination) {
    const instruction: DestinationPaymentInstruction = {
      type: "destination",
      payment_destination,
      raw,
    };

    if (payment_uri) {
      instruction.payment_uri = payment_uri;
    }

    if (verify_url) {
      instruction.verify_url = verify_url;
    }

    return instruction;
  }

  throw new InvalidCallbackResponseError(
    "Payment callback response must include pr or paymentDestination",
  );
}

function build_callback_url(pay_request: PayRequest, options: RequestPaymentOptions): URL {
  let callback_url: URL;

  try {
    callback_url = assert_http_url(pay_request.callback, options);
  } catch (cause) {
    throw new InvalidCallbackResponseError("Pay request callback URL is invalid", { cause });
  }

  callback_url.searchParams.set("amount", amount_to_msat_string(options.amount_msat));

  if (options.comment !== undefined) {
    callback_url.searchParams.set("comment", options.comment);
  }

  if (options.payer_data !== undefined) {
    callback_url.searchParams.set("payerdata", JSON.stringify(options.payer_data));
  }

  return callback_url;
}

export async function request_payment(
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
  if (options.allow_onion !== undefined) {
    resolve_options.allow_onion = options.allow_onion;
  }

  const pay_request = is_pay_request(pay_request_or_input)
    ? pay_request_or_input
    : await resolve(pay_request_or_input, resolve_options);

  validate_callback_amount(pay_request, options.amount_msat);
  validate_comment(pay_request, options.comment);
  validate_mandatory_payer_data(pay_request, options.payer_data);

  const callback_url = build_callback_url(pay_request, options);
  const fetcher = get_fetch(options.fetch);
  let response: Response;

  try {
    response = await fetcher(callback_url, {
      headers: merge_headers(options.headers),
    });
  } catch (cause) {
    throw new NetworkError(`Failed to request payment instruction: ${callback_url.toString()}`, {
      cause,
    });
  }

  if (!response.ok) {
    throw new NetworkError(
      `Failed to request payment instruction: ${response.status} ${response.statusText}`,
    );
  }

  let raw: unknown;
  try {
    raw = await read_json_response(response);
  } catch (cause) {
    throw new InvalidCallbackResponseError("Payment callback response is not valid JSON", {
      cause,
    });
  }

  return parse_callback_response(raw, options.validate_bolt11 ?? true);
}

export async function pay(
  input: string,
  options: RequestPaymentOptions,
): Promise<PaymentInstruction> {
  return request_payment(input, options);
}
