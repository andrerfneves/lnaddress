export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type UrlSafetyOptions = {
  allowOnion?: boolean;
  allowPrivateNetwork?: boolean;
};

export type Bolt11Network = "bitcoin" | "testnet" | "regtest" | "signet";
export type RedirectPolicy = "follow" | "error" | "same-origin" | "no-downgrade";
export type ProviderPolicy = "off" | "same-origin" | "same-site";
export type NodePubkeyPolicy = "warn" | "enforce" | "off";
export type Bolt11PayeeNodeIdSource = "n" | "signature";

export type FetchControls = {
  signal?: AbortSignal;
  timeoutMs?: number;
  redirectPolicy?: RedirectPolicy;
};

export type ResolveOptions = UrlSafetyOptions & {
  fetch?: FetchLike;
  headers?: HeadersInit;
} & FetchControls;

export type DenominatedAmount = {
  amount: number | bigint;
  currency: string;
};

type RequestPaymentBaseOptions = UrlSafetyOptions & {
  comment?: string;
  payerData?: Record<string, unknown>;
  paymentOption?: string;
  convert?: string;
  fetch?: FetchLike;
  headers?: HeadersInit;
  validateBolt11?: boolean;
  validateMetadataHash?: boolean;
  expectedNetwork?: Bolt11Network;
  validateExpiry?: boolean;
  now?: Date | number | (() => Date | number);
  providerPolicy?: ProviderPolicy;
  nodePubkeyPolicy?: NodePubkeyPolicy;
} & FetchControls;

export type RequestPaymentOptions = RequestPaymentBaseOptions &
  (
    | { amountMsat: number | bigint; denominatedAmount?: never }
    | { amountMsat?: never; denominatedAmount: DenominatedAmount }
  );

export type VerifyPaymentOptions = UrlSafetyOptions & {
  fetch?: FetchLike;
  headers?: HeadersInit;
} & FetchControls;

export type FetchServiceKeysOptions = UrlSafetyOptions & {
  fetch?: FetchLike;
  headers?: HeadersInit;
} & FetchControls;

export type ParseServiceKeysContext = UrlSafetyOptions & {
  sourceUrl?: string;
};

export type DomainServiceKeyAlgorithm = "secp256k1";

export type DomainServiceKey = {
  id: string;
  algorithm: DomainServiceKeyAlgorithm;
  publicKey: string;
  expiresAt?: number;
  certChain?: string[];
  raw: Record<string, unknown>;
};

export type DomainServiceKeys = {
  domain?: string;
  signingKeys?: DomainServiceKey[];
  encryptionKeys?: DomainServiceKey[];
  sourceUrl?: string;
  raw: Record<string, unknown>;
};

export type LightningAddress = {
  username: string;
  domain: string;
  address: string;
};

export type MetadataEntry = [mimeType: string, value: unknown];

export type MetadataImage = {
  mimeType: string;
  data: string;
  dataUri: string;
};

export type PayerDataField = {
  mandatory?: boolean;
  name?: string;
  k1?: string;
  raw: Record<string, unknown>;
};

export type PayerData = Record<string, PayerDataField>;

export type CurrencyConvertible = {
  min: number;
  max: number;
};

export type Currency = {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  multiplier: number;
  convertible?: CurrencyConvertible;
  raw?: Record<string, unknown>;
};

export type ConvertedAmount = {
  multiplier: number;
  amount: number;
  fee: number;
  raw: Record<string, unknown>;
};

export type PaymentOption = {
  id: string;
  type: string;
  available?: boolean;
  minSendableMsat?: bigint;
  maxSendableMsat?: bigint;
  currencies?: Currency[];
  raw: Record<string, unknown>;
};

export type NodePubkey = {
  pubkey: string;
  raw: Record<string, unknown>;
};

export type NodePubkeyVerification =
  | {
      status: "verified";
      payeeNodeId: string;
      payeeNodeIdSource: Bolt11PayeeNodeIdSource;
      expectedPubkeys: string[];
      matchedPubkey: string;
    }
  | {
      status: "mismatch";
      payeeNodeId: string;
      payeeNodeIdSource: Bolt11PayeeNodeIdSource;
      expectedPubkeys: string[];
      warning: string;
    };

export type PayRequest = {
  tag: "payRequest";
  callback: string;
  minSendableMsat: bigint;
  maxSendableMsat: bigint;
  metadata: MetadataEntry[];
  metadataRaw: string;
  metadataHash: string;
  description?: string;
  image?: MetadataImage;
  commentAllowed?: number;
  payerData?: PayerData;
  paymentOptions?: PaymentOption[];
  currencies?: Currency[];
  nodePubkeys?: NodePubkey[];
  raw: unknown;
  sourceUrl?: string;
  lightningAddress?: LightningAddress;
};

export type Bolt11PaymentInstruction = {
  type: "bolt11";
  pr: string;
  routes?: [];
  paymentOption?: string;
  paymentDestination?: string;
  paymentUri?: string;
  verifyUrl?: string;
  successAction?: SuccessAction;
  converted?: ConvertedAmount;
  nodePubkeyVerification?: NodePubkeyVerification;
  raw: unknown;
};

export type DestinationPaymentInstruction = {
  type: "destination";
  paymentOption?: string;
  verifyUrl?: string;
  converted?: ConvertedAmount;
  raw: unknown;
} & (
  | { paymentDestination: string; paymentUri?: string }
  | { paymentDestination?: string; paymentUri: string }
);

export type PaymentInstruction = Bolt11PaymentInstruction | DestinationPaymentInstruction;

export type VerifyResult = {
  status: "OK" | "ERROR";
  settled?: boolean;
  preimage?: string | null;
  pr?: string;
  paymentOption?: string;
  paymentDestination?: string;
  paymentUri?: string;
  paymentReference?: string | null;
  reason?: string;
  raw: unknown;
};

export type SuccessAction =
  | { tag: "message"; message: string }
  | { tag: "url"; description: string; url: string }
  | {
      tag: "aes";
      description: string;
      ciphertext: string;
      iv: string;
      decrypt(preimage: string): string;
    }
  | { tag: string; raw: unknown };
