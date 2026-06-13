import { NetworkError, VerifyError } from "./errors";
import {
  assertRedirectPolicy,
  getFetch,
  readBoolean,
  readJsonResponse,
  readString,
  requestInit,
  unknownToRecord,
} from "./internal";
import type { PaymentInstruction, VerifyPaymentOptions, VerifyResult } from "./types";

function verifyUrl_from_input(payment_or_verifyUrl: PaymentInstruction | string): string {
  if (typeof payment_or_verifyUrl === "string") {
    return payment_or_verifyUrl;
  }

  if (payment_or_verifyUrl.verifyUrl) {
    return payment_or_verifyUrl.verifyUrl;
  }

  throw new VerifyError("Payment instruction does not include a verifyUrl");
}

export async function verifyPayment(
  payment_or_verifyUrl: PaymentInstruction | string,
  options: VerifyPaymentOptions = {},
): Promise<VerifyResult> {
  const verifyUrl = verifyUrl_from_input(payment_or_verifyUrl);

  let parsed_url: URL;
  try {
    parsed_url = new URL(verifyUrl);
  } catch (cause) {
    throw new VerifyError("verifyUrl is invalid", { cause });
  }

  if (parsed_url.protocol !== "https:" && parsed_url.protocol !== "http:") {
    throw new VerifyError("verifyUrl must use http or https");
  }

  const fetcher = getFetch(options.fetch);
  let response: Response;
  const { init, cleanup } = requestInit(options.headers, options);

  try {
    response = await fetcher(parsed_url, init);
  } catch (cause) {
    throw new NetworkError(`Failed to verify payment: ${parsed_url.toString()}`, { cause });
  } finally {
    cleanup();
  }

  assertRedirectPolicy(parsed_url, response, options);

  if (!response.ok) {
    throw new NetworkError(`Failed to verify payment: ${response.status} ${response.statusText}`);
  }

  let raw: unknown;
  try {
    raw = await readJsonResponse(response);
  } catch (cause) {
    throw new VerifyError("Verify response is not valid JSON", { cause });
  }

  const record = unknownToRecord(raw);
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

  const settled = readBoolean(record, ["settled"]);
  if (settled !== undefined) {
    result.settled = settled;
  }

  const preimage = readString(record, ["preimage"]);
  if (preimage !== undefined) {
    result.preimage = preimage;
  } else if ("preimage" in record && record.preimage === null) {
    result.preimage = null;
  }

  const pr = readString(record, ["pr"]);
  if (pr) {
    result.pr = pr;
  }

  const paymentDestination = readString(record, ["paymentDestination"]);
  if (paymentDestination) {
    result.paymentDestination = paymentDestination;
  }

  const paymentOption = readString(record, ["paymentOption"]);
  if (paymentOption !== undefined) {
    result.paymentOption = paymentOption;
  }

  const paymentReference = readString(record, ["paymentReference"]);
  if (paymentReference !== undefined) {
    result.paymentReference = paymentReference;
  } else if ("paymentReference" in record && record.paymentReference === null) {
    result.paymentReference = null;
  }

  const reason = readString(record, ["reason", "message", "error"]);
  if (reason) {
    result.reason = reason;
  }

  return result;
}
