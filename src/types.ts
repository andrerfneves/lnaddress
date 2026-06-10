export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type UrlSafetyOptions = {
  allow_onion?: boolean;
};

export type Bolt11Network = "bitcoin" | "testnet" | "regtest" | "signet";

export type ResolveOptions = UrlSafetyOptions & {
  fetch?: FetchLike;
  headers?: HeadersInit;
};

export type RequestPaymentOptions = UrlSafetyOptions & {
  amount_msat: number | bigint;
  comment?: string;
  payer_data?: Record<string, unknown>;
  fetch?: FetchLike;
  headers?: HeadersInit;
  validate_bolt11?: boolean;
  expected_network?: Bolt11Network;
  validate_expiry?: boolean;
  now?: Date | number | (() => Date | number);
};

export type VerifyPaymentOptions = UrlSafetyOptions & {
  fetch?: FetchLike;
  headers?: HeadersInit;
};

export type LightningAddress = {
  username: string;
  domain: string;
  address: string;
};

export type MetadataEntry = [mime_type: string, value: string];

export type MetadataImage = {
  mime_type: string;
  data: string;
  data_uri: string;
};

export type PayerDataField = {
  mandatory?: boolean;
  name?: string;
  k1?: string;
  raw: Record<string, unknown>;
};

export type PayerData = Record<string, PayerDataField>;

export type PayRequest = {
  tag: "payRequest";
  callback: string;
  min_sendable_msat: bigint;
  max_sendable_msat: bigint;
  metadata: MetadataEntry[];
  metadata_raw: string;
  metadata_hash: string;
  description?: string;
  image?: MetadataImage;
  comment_allowed?: number;
  payer_data?: PayerData;
  currencies?: unknown;
  convert?: unknown;
  converted?: unknown;
  raw: unknown;
  source_url?: string;
  lightning_address?: LightningAddress;
};

export type Bolt11PaymentInstruction = {
  type: "bolt11";
  pr: string;
  routes?: [];
  payment_destination?: string;
  payment_uri?: string;
  verify_url?: string;
  success_action?: SuccessAction;
  raw: unknown;
};

export type DestinationPaymentInstruction = {
  type: "destination";
  payment_destination: string;
  payment_uri?: string;
  verify_url?: string;
  raw: unknown;
};

export type PaymentInstruction = Bolt11PaymentInstruction | DestinationPaymentInstruction;

export type VerifyResult = {
  status: "OK" | "ERROR";
  settled?: boolean;
  preimage?: string | null;
  pr?: string;
  payment_destination?: string;
  payment_reference?: string | null;
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
