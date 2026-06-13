import { InvalidLightningAddressError } from "./errors";
import type { LightningAddress } from "./types";

const username_pattern = /^[A-Za-z0-9._~+-]+$/;
const domain_label_pattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function is_valid_domain(hostname: string): boolean {
  if (hostname.length > 253) {
    return false;
  }

  const labels = hostname.split(".");
  const tld = labels.at(-1);
  return !!tld && /[a-z]/.test(tld) && labels.every((label) => domain_label_pattern.test(label));
}

export function parseLightningAddress(address: string): LightningAddress {
  const value = address.trim();
  const at_index = value.indexOf("@");

  if (at_index <= 0 || at_index !== value.lastIndexOf("@") || at_index === value.length - 1) {
    throw new InvalidLightningAddressError("Lightning Address must be in username@domain form");
  }

  const username = value.slice(0, at_index);
  const domain_input = value.slice(at_index + 1);

  if (!username_pattern.test(username)) {
    throw new InvalidLightningAddressError(
      "Lightning Address username contains invalid characters",
    );
  }

  if (domain_input.includes(":")) {
    throw new InvalidLightningAddressError("Lightning Address domain is invalid");
  }

  let url: URL;
  try {
    url = new URL(`https://${domain_input}`);
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
    !is_valid_domain(url.hostname.toLowerCase())
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
