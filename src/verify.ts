import { NetworkError, VerifyError } from "./errors";
import {
  assert_redirect_policy,
  get_fetch,
  read_boolean,
  read_json_response,
  read_string,
  request_init,
  unknown_to_record,
} from "./internal";
import type { PaymentInstruction, VerifyPaymentOptions, VerifyResult } from "./types";

function verify_url_from_input(payment_or_verify_url: PaymentInstruction | string): string {
  if (typeof payment_or_verify_url === "string") {
    return payment_or_verify_url;
  }

  if (payment_or_verify_url.verify_url) {
    return payment_or_verify_url.verify_url;
  }

  throw new VerifyError("Payment instruction does not include a verify_url");
}

export async function verify_payment(
  payment_or_verify_url: PaymentInstruction | string,
  options: VerifyPaymentOptions = {},
): Promise<VerifyResult> {
  const verify_url = verify_url_from_input(payment_or_verify_url);

  let parsed_url: URL;
  try {
    parsed_url = new URL(verify_url);
  } catch (cause) {
    throw new VerifyError("verify_url is invalid", { cause });
  }

  if (parsed_url.protocol !== "https:" && parsed_url.protocol !== "http:") {
    throw new VerifyError("verify_url must use http or https");
  }

  const fetcher = get_fetch(options.fetch);
  let response: Response;
  const { init, cleanup } = request_init(options.headers, options);

  try {
    response = await fetcher(parsed_url, init);
  } catch (cause) {
    throw new NetworkError(`Failed to verify payment: ${parsed_url.toString()}`, { cause });
  } finally {
    cleanup();
  }

  assert_redirect_policy(parsed_url, response, options);

  if (!response.ok) {
    throw new NetworkError(`Failed to verify payment: ${response.status} ${response.statusText}`);
  }

  let raw: unknown;
  try {
    raw = await read_json_response(response);
  } catch (cause) {
    throw new VerifyError("Verify response is not valid JSON", { cause });
  }

  const record = unknown_to_record(raw);
  if (!record) {
    throw new VerifyError("Verify response must be an object");
  }

  if (record.status !== "OK" && record.status !== "ERROR") {
    throw new VerifyError("Verify response status must be OK or ERROR");
  }

  const result: VerifyResult = {
    status: record.status,
    raw,
  };

  const settled = read_boolean(record, ["settled"]);
  if (settled !== undefined) {
    result.settled = settled;
  }

  const preimage = read_string(record, ["preimage"]);
  if (preimage !== undefined) {
    result.preimage = preimage;
  } else if ("preimage" in record && record.preimage === null) {
    result.preimage = null;
  }

  const pr = read_string(record, ["pr"]);
  if (pr) {
    result.pr = pr;
  }

  const payment_destination = read_string(record, ["paymentDestination", "payment_destination"]);
  if (payment_destination) {
    result.payment_destination = payment_destination;
  }

  const payment_reference = read_string(record, ["paymentReference", "payment_reference"]);
  if (payment_reference !== undefined) {
    result.payment_reference = payment_reference;
  } else if ("paymentReference" in record && record.paymentReference === null) {
    result.payment_reference = null;
  }

  const reason = read_string(record, ["reason", "message", "error"]);
  if (reason) {
    result.reason = reason;
  }

  return result;
}
