import { InvalidLightningAddressError } from "./errors";
import type { LightningAddress } from "./types";

const username_pattern = /^[A-Za-z0-9._~+-]+$/;

export function parse_lightning_address(address: string): LightningAddress {
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
    url.pathname !== "/" ||
    url.search ||
    url.hash
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

export function is_lightning_address(value: string): boolean {
  try {
    parse_lightning_address(value);
    return true;
  } catch {
    return false;
  }
}
