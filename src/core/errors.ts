export type LnAddressErrorCode =
  | "INVALID_LIGHTNING_ADDRESS"
  | "INVALID_LNURL"
  | "NETWORK_ERROR"
  | "INVALID_PAY_REQUEST"
  | "AMOUNT_OUT_OF_RANGE"
  | "COMMENT_NOT_ALLOWED"
  | "COMMENT_TOO_LONG"
  | "MISSING_MANDATORY_PAYER_DATA"
  | "INVALID_CALLBACK_RESPONSE"
  | "INVALID_PAYMENT_OPTION"
  | "INVALID_REQUEST_PAYMENT_OPTIONS"
  | "NODE_PUBKEY_MISMATCH"
  | "INVALID_SERVICE_KEYS"
  | "VERIFY_ERROR";

export class LnAddressError extends Error {
  readonly code: LnAddressErrorCode;
  override readonly cause?: unknown;

  constructor(code: LnAddressErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.cause = options?.cause;
  }
}

export class InvalidLightningAddressError extends LnAddressError {
  constructor(message = "Invalid Lightning Address", options?: { cause?: unknown }) {
    super("INVALID_LIGHTNING_ADDRESS", message, options);
  }
}

export class InvalidLnurlError extends LnAddressError {
  constructor(message = "Invalid LNURL", options?: { cause?: unknown }) {
    super("INVALID_LNURL", message, options);
  }
}

export class NetworkError extends LnAddressError {
  constructor(message = "Network request failed", options?: { cause?: unknown }) {
    super("NETWORK_ERROR", message, options);
  }
}

export class InvalidPayRequestError extends LnAddressError {
  constructor(message = "Invalid LNURL-pay request", options?: { cause?: unknown }) {
    super("INVALID_PAY_REQUEST", message, options);
  }
}

export class AmountOutOfRangeError extends LnAddressError {
  constructor(message = "Amount is outside the allowed range", options?: { cause?: unknown }) {
    super("AMOUNT_OUT_OF_RANGE", message, options);
  }
}

export class CommentNotAllowedError extends LnAddressError {
  constructor(
    message = "Comments are not allowed for this pay request",
    options?: { cause?: unknown },
  ) {
    super("COMMENT_NOT_ALLOWED", message, options);
  }
}

export class CommentTooLongError extends LnAddressError {
  constructor(message = "Comment exceeds the allowed length", options?: { cause?: unknown }) {
    super("COMMENT_TOO_LONG", message, options);
  }
}

export class MissingMandatoryPayerDataError extends LnAddressError {
  readonly missingFields: string[];

  constructor(missingFields: string[], options?: { cause?: unknown }) {
    super(
      "MISSING_MANDATORY_PAYER_DATA",
      `Missing mandatory payer data: ${missingFields.join(", ")}`,
      options,
    );
    this.missingFields = missingFields;
  }
}

export class InvalidCallbackResponseError extends LnAddressError {
  constructor(message = "Invalid payment callback response", options?: { cause?: unknown }) {
    super("INVALID_CALLBACK_RESPONSE", message, options);
  }
}

export class InvalidPaymentOptionError extends LnAddressError {
  constructor(message = "Invalid payment option", options?: { cause?: unknown }) {
    super("INVALID_PAYMENT_OPTION", message, options);
  }
}

export class InvalidRequestPaymentOptionsError extends LnAddressError {
  constructor(message = "Invalid request payment options", options?: { cause?: unknown }) {
    super("INVALID_REQUEST_PAYMENT_OPTIONS", message, options);
  }
}

export class NodePubkeyMismatchError extends LnAddressError {
  constructor(
    message = "BOLT11 invoice payee node does not match advertised nodePubkeys",
    options?: { cause?: unknown },
  ) {
    super("NODE_PUBKEY_MISMATCH", message, options);
  }
}

export class InvalidServiceKeysError extends LnAddressError {
  constructor(message = "Invalid LNURL service keys document", options?: { cause?: unknown }) {
    super("INVALID_SERVICE_KEYS", message, options);
  }
}

export class VerifyError extends LnAddressError {
  constructor(message = "Invalid payment verification response", options?: { cause?: unknown }) {
    super("VERIFY_ERROR", message, options);
  }
}
