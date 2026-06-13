import {
  AmountOutOfRangeError,
  InvalidCallbackResponseError,
  InvalidRequestPaymentOptionsError,
} from "./errors";
import { amountToMsatString } from "./internal";
import type { Currency, PayRequest, RequestPaymentOptions } from "./types";

export type CurrencyValidationOptions = {
  requireConvertible?: boolean;
};

export function effectiveCurrencies(
  payRequest: PayRequest,
  paymentOption?: string,
): Currency[] | undefined {
  if (paymentOption !== undefined && payRequest.paymentOptions) {
    const option = payRequest.paymentOptions.find((candidate) => candidate.id === paymentOption);
    if (option?.currencies) {
      return option.currencies;
    }
  }

  return payRequest.currencies;
}

export function findEffectiveCurrency(
  payRequest: PayRequest,
  currency: string,
  paymentOption?: string,
): Currency | undefined {
  return effectiveCurrencies(payRequest, paymentOption)?.find(
    (candidate) => candidate.code === currency,
  );
}

export function validateCurrency(
  payRequest: PayRequest,
  currency?: string,
  paymentOption?: string,
  options: CurrencyValidationOptions = {},
): void {
  if (currency === undefined) {
    return;
  }

  const currencies = effectiveCurrencies(payRequest, paymentOption);
  if (!currencies) {
    throw new InvalidRequestPaymentOptionsError("Pay request does not support currencies");
  }

  const match = findEffectiveCurrency(payRequest, currency, paymentOption);
  if (!match) {
    const scope = paymentOption === undefined ? "pay request" : `paymentOption ${paymentOption}`;
    throw new InvalidRequestPaymentOptionsError(
      `Currency ${currency} is not available for ${scope}`,
    );
  }

  if (options.requireConvertible && !match.convertible) {
    throw new InvalidRequestPaymentOptionsError(`Currency ${currency} is not convertible`);
  }
}

export function amountToPositiveIntegerString(amount: number | bigint, field: string): string {
  if (typeof amount === "bigint") {
    if (amount <= 0n) {
      throw new AmountOutOfRangeError(`${field} must be a positive integer`);
    }
    return amount.toString();
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AmountOutOfRangeError(`${field} must be a positive safe integer`);
  }

  return String(amount);
}

export function assertCurrencyCodeForAmount(currency: string): void {
  if (currency.length === 0 || currency.trim() !== currency || currency.includes(".")) {
    throw new InvalidCallbackResponseError(
      "denominatedAmount.currency must be a non-empty currency code without '.'",
    );
  }
}

export function callbackAmountValue(options: RequestPaymentOptions): string {
  if (options.denominatedAmount !== undefined) {
    assertCurrencyCodeForAmount(options.denominatedAmount.currency);
    const amount = amountToPositiveIntegerString(
      options.denominatedAmount.amount,
      "denominatedAmount.amount",
    );
    return `${amount}.${options.denominatedAmount.currency}`;
  }

  if (options.amountMsat === undefined) {
    throw new AmountOutOfRangeError("amountMsat or denominatedAmount is required");
  }

  return amountToMsatString(options.amountMsat);
}
