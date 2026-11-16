import { sha256 } from "js-sha256";
import { VerifyError } from "../core/errors";
import type {
  PaymentInstruction,
  PaymentQuote,
  VerifyPaymentOptions,
  VerifyResult,
} from "../core/types";
import { parsePaymentQuote } from "../extensions/units";
import { decodeBolt11 } from "../lightning/bolt11";
import { JsonBodyError, fetchJson } from "../utils/http";
import { assertHttpUrl, readBoolean, readString, unknownToRecord } from "../utils/internal";

function normalizeInvoice(pr: string): string {
  return pr.trim().toLowerCase();
}

/** Returns the invoice payment hash, or undefined when the invoice cannot be decoded. */
async function invoicePaymentHash(pr: string): Promise<string | undefined> {
  try {
    return (await decodeBolt11(pr)).paymentHash;
  } catch {
    return undefined;
  }
}

/**
 * Checks the provider's verify claims against the invoice: the echoed `pr` must be the
 * invoice that was requested, and `sha256(preimage)` must equal its payment hash.
 */
async function checkInvoiceClaims(
  payment: PaymentInstruction | string,
  result: VerifyResult,
): Promise<void> {
  const requestedPr =
    typeof payment === "string" ? undefined : payment.type === "bolt11" ? payment.pr : undefined;

  if (requestedPr && result.pr && normalizeInvoice(result.pr) !== normalizeInvoice(requestedPr)) {
    throw new VerifyError("Verify response pr does not match the requested invoice");
  }

  const pr = requestedPr ?? result.pr;
  if (!pr || typeof result.preimage !== "string" || result.preimage === "") {
    return;
  }

  const paymentHash = await invoicePaymentHash(pr);
  if (!paymentHash) {
    return;
  }

  const preimage = result.preimage.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(preimage)) {
    throw new VerifyError("Verify response preimage must be 32-byte hex");
  }

  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(preimage.slice(i * 2, i * 2 + 2), 16);
  }

  if (sha256(bytes) !== paymentHash) {
    throw new VerifyError("Verify response preimage does not match the invoice payment hash");
  }

  result.preimageVerified = true;
}

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

  let raw: unknown;
  try {
    raw = await fetchJson(parsedUrl, options, "verify payment");
  } catch (cause) {
    if (cause instanceof JsonBodyError) {
      throw new VerifyError("Verify response is not valid JSON", { cause });
    }
    throw cause;
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

  const paymentUri = readString(record, ["paymentURI", "paymentUri"]);
  if (paymentUri) {
    result.paymentUri = paymentUri;
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

  let paymentQuote: PaymentQuote | undefined;
  try {
    paymentQuote = parsePaymentQuote(record.paymentQuote, false);
  } catch (cause) {
    throw new VerifyError("Invalid paymentQuote in verify response", { cause });
  }
  if (paymentQuote) {
    result.paymentQuote = paymentQuote;
  }

  const reason = readString(record, ["reason", "message", "error"]);
  if (reason) {
    result.reason = reason;
  }

  await checkInvoiceClaims(paymentOrVerifyUrl, result);

  return result;
}
