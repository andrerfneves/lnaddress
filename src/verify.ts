import { NetworkError, VerifyError } from "./errors";
import {
  assertHttpUrl,
  assertRedirectPolicy,
  fetchWithRedirectPolicy,
  getFetch,
  readBoolean,
  readJsonResponse,
  readString,
  requestInit,
  unknownToRecord,
} from "./internal";
import type { PaymentInstruction, VerifyPaymentOptions, VerifyResult } from "./types";

function verifyUrlFromInput(paymentOrVerifyUrl: PaymentInstruction | string): string {
  if (typeof paymentOrVerifyUrl === "string") {
    return paymentOrVerifyUrl;
  }

  if (paymentOrVerifyUrl.verifyUrl) {
    return paymentOrVerifyUrl.verifyUrl;
  }

  throw new VerifyError("Payment instruction does not include a verifyUrl");
}

export async function verifyPayment(
  paymentOrVerifyUrl: PaymentInstruction | string,
  options: VerifyPaymentOptions = {},
): Promise<VerifyResult> {
  const verifyUrl = verifyUrlFromInput(paymentOrVerifyUrl);

  let parsedUrl: URL;
  try {
    parsedUrl = assertHttpUrl(verifyUrl, options);
  } catch (cause) {
    throw new VerifyError("verifyUrl is invalid", { cause });
  }

  const fetcher = getFetch(options.fetch);
  let response: Response;
  const { init, cleanup } = requestInit(options.headers, options);

  try {
    response = await fetchWithRedirectPolicy(fetcher, parsedUrl, init, options);
  } catch (cause) {
    throw new NetworkError(`Failed to verify payment: ${parsedUrl.toString()}`, { cause });
  } finally {
    cleanup();
  }

  assertRedirectPolicy(parsedUrl, response, options);

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
