import { InvalidLightningAddressError } from "./errors";
import type { LightningAddress } from "./types";

const usernamePattern = /^[a-z0-9._+-]+$/;
const domainLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function isValidDomain(hostname: string): boolean {
  if (hostname.length > 253) {
    return false;
  }

  const labels = hostname.split(".");
  const tld = labels.at(-1);
  return !!tld && /[a-z]/.test(tld) && labels.every((label) => domainLabelPattern.test(label));
}

export function parseLightningAddress(address: string): LightningAddress {
  const value = address.trim();
  const atIndex = value.indexOf("@");

  if (atIndex <= 0 || atIndex !== value.lastIndexOf("@") || atIndex === value.length - 1) {
    throw new InvalidLightningAddressError("Lightning Address must be in username@domain form");
  }

  const username = value.slice(0, atIndex);
  const domainInput = value.slice(atIndex + 1);

  if (!usernamePattern.test(username)) {
    throw new InvalidLightningAddressError(
      "Lightning Address username contains invalid characters",
    );
  }

  if (domainInput.includes(":")) {
    throw new InvalidLightningAddressError("Lightning Address domain is invalid");
  }

  let url: URL;
  try {
    url = new URL(`https://${domainInput}`);
  } catch (cause) {
    throw new InvalidLightningAddressError("Lightning Address domain is invalid", { cause });
  }

  if (
    !url.hostname ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !isValidDomain(url.hostname.toLowerCase())
  ) {
    throw new InvalidLightningAddressError("Lightning Address domain is invalid");
  }

  const domain = url.hostname.toLowerCase();

  return {
    username,
    domain,
    address: `${username}@${domain}`,
  };
}

export function isLightningAddress(value: string): boolean {
  try {
    parseLightningAddress(value);
    return true;
  } catch {
    return false;
  }
}
