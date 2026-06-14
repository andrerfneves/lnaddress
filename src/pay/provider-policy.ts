import { InvalidCallbackResponseError } from "../core/errors";
import type { PayRequest, RequestPaymentOptions } from "../core/types";

function sameSite(hostname: string, expectedHostname: string): boolean {
  return (
    hostname === expectedHostname || hostname.endsWith(`.${expectedHostname}`)
  );
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

export function assertProviderPolicy(
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
    throw new InvalidCallbackResponseError(
      `${label} does not match provider origin`,
    );
  }

  if (policy === "same-site" && !sameSite(parsed.hostname, base.hostname)) {
    throw new InvalidCallbackResponseError(
      `${label} does not match provider site`,
    );
  }
}
