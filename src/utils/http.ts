import { NetworkError } from "../core/errors";
import type { FetchControls, FetchLike, RedirectPolicy, UrlSafetyOptions } from "../core/types";
import { assertHttpUrl } from "./internal";

export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Credentials that must not follow a redirect to another origin. */
const CROSS_ORIGIN_STRIPPED_HEADERS = ["authorization", "proxy-authorization", "cookie"];

export type HttpOptions = UrlSafetyOptions &
  FetchControls & {
    fetch?: FetchLike;
    headers?: HeadersInit;
  };

/** The response body arrived but is not valid JSON. Callers map it to their own error type. */
export class JsonBodyError extends TypeError {}

function getFetch(fetcher?: FetchLike): FetchLike {
  const selected = fetcher ?? globalThis.fetch;

  if (!selected) {
    throw new NetworkError("No fetch implementation is available");
  }

  return selected.bind(globalThis) as FetchLike;
}

function requestHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  if (!merged.has("accept")) {
    merged.set("accept", "application/json");
  }
  return merged;
}

function positiveSafeInteger(value: number | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new NetworkError(`${name} must be a positive safe integer`);
  }
  return value;
}

/**
 * Combines the caller's `signal` with `timeoutMs`. The returned signal stays live until
 * `cleanup()` runs, so it covers the response body as well as the headers.
 */
function requestSignal(options: FetchControls): { signal?: AbortSignal; cleanup: () => void } {
  const timeoutMs = positiveSafeInteger(options.timeoutMs, "timeoutMs");
  if (timeoutMs === undefined) {
    return options.signal ? { signal: options.signal, cleanup: () => {} } : { cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new NetworkError(`Request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  const cleanups = [() => clearTimeout(timeout)];

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort(options.signal.reason);
    } else {
      const abort = () => controller.abort(options.signal?.reason);
      options.signal.addEventListener("abort", abort, { once: true });
      cleanups.push(() => options.signal?.removeEventListener("abort", abort));
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new NetworkError("Request was aborted");
}

/** Rejects as soon as `signal` aborts, even if the underlying promise ignores the signal. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best effort: the body is being thrown away.
  }
}

function assertAllowedTarget(
  original: URL,
  target: string,
  policy: RedirectPolicy,
  options: UrlSafetyOptions,
): URL {
  let parsed: URL;
  try {
    parsed = assertHttpUrl(target, options);
  } catch (cause) {
    throw new NetworkError(`Redirect target is not allowed: ${target}`, { cause });
  }

  if (policy === "error") {
    throw new NetworkError("Redirected responses are disabled by redirectPolicy");
  }

  if (policy === "same-origin" && parsed.origin !== original.origin) {
    throw new NetworkError("Redirect target changed origin");
  }

  if (policy === "no-downgrade" && original.protocol === "https:" && parsed.protocol === "http:") {
    throw new NetworkError("Redirect target downgraded from https to http");
  }

  return parsed;
}

/**
 * Fetches `url`, following redirects itself so every hop is checked against the URL
 * safety options and `redirectPolicy` before it is requested.
 *
 * Browsers hide redirect targets from `redirect: "manual"` (an `opaqueredirect`
 * response). In that case the request is repeated with native redirect handling and
 * the final URL is checked instead.
 */
async function fetchFollowingRedirects(
  fetcher: FetchLike,
  url: URL,
  baseHeaders: Headers,
  signal: AbortSignal | undefined,
  options: HttpOptions,
): Promise<Response> {
  const policy = options.redirectPolicy ?? "follow";
  const headers = new Headers(baseHeaders);
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const init: RequestInit = { headers, redirect: "manual" };
    if (signal) init.signal = signal;
    const response = await fetcher(current, init);

    if (response.type === "opaqueredirect") {
      if (policy === "error") {
        throw new NetworkError("Redirected responses are disabled by redirectPolicy");
      }
      const nativeInit: RequestInit = { headers, redirect: "follow" };
      if (signal) nativeInit.signal = signal;
      const followed = await fetcher(current, nativeInit);
      if (followed.redirected && followed.url) {
        assertAllowedTarget(url, followed.url, policy, options);
      }
      return followed;
    }

    const location = REDIRECT_STATUSES.has(response.status)
      ? response.headers.get("location")
      : null;

    if (!location) {
      // A custom fetch may have followed redirects itself; check where it ended up.
      if (response.redirected && response.url) {
        assertAllowedTarget(url, response.url, policy, options);
      }
      return response;
    }

    await discardBody(response);
    const target = assertAllowedTarget(url, new URL(location, current).toString(), policy, options);

    if (target.origin !== current.origin) {
      for (const name of CROSS_ORIGIN_STRIPPED_HEADERS) headers.delete(name);
    }
    current = target;
  }

  throw new NetworkError("Too many redirects");
}

function contentLengthExceeds(response: Response, maxBytes: number): boolean {
  const header = response.headers?.get?.("content-length");
  if (!header || !/^\d+$/.test(header)) {
    return false;
  }
  return Number(header) > maxBytes;
}

async function readBodyText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  const tooLarge = () => new NetworkError(`Response body exceeds ${maxBytes} bytes`);

  if (contentLengthExceeds(response, maxBytes)) {
    await discardBody(response);
    throw tooLarge();
  }

  const body = response.body;
  if (!body) {
    const text = await abortable(response.text(), signal);
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw tooLarge();
    }
    return text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  }

  return text + decoder.decode();
}

/** Wraps a failure, keeping the underlying reason visible in the message. */
function failure(action: string, url: URL, cause: unknown): NetworkError {
  const reason = cause instanceof Error && cause.message ? ` (${cause.message})` : "";
  return new NetworkError(`Failed to ${action}: ${url.toString()}${reason}`, { cause });
}

/**
 * GETs `url` and parses the JSON body, enforcing `redirectPolicy`, URL safety on every
 * redirect hop, `timeoutMs`/`signal` through the end of the body, and `maxResponseBytes`.
 *
 * Throws `NetworkError` (prefixed with `Failed to <action>`) for transport, status, and
 * size failures, and `JsonBodyError` when the body is not JSON.
 */
export async function fetchJson(url: URL, options: HttpOptions, action: string): Promise<unknown> {
  const fetcher = getFetch(options.fetch);
  const maxBytes =
    positiveSafeInteger(options.maxResponseBytes, "maxResponseBytes") ?? DEFAULT_MAX_RESPONSE_BYTES;
  const { signal, cleanup } = requestSignal(options);

  try {
    let response: Response;
    try {
      response = await fetchFollowingRedirects(
        fetcher,
        url,
        requestHeaders(options.headers),
        signal,
        options,
      );
    } catch (cause) {
      throw failure(action, url, cause);
    }

    if (!response.ok) {
      await discardBody(response);
      throw new NetworkError(`Failed to ${action}: ${response.status} ${response.statusText}`);
    }

    if (!response.body && typeof response.text !== "function") {
      // Minimal custom fetch responses may only implement json().
      try {
        return await abortable(response.json(), signal);
      } catch (cause) {
        if (signal?.aborted) {
          throw failure(action, url, cause);
        }
        throw new JsonBodyError("Response body is not valid JSON", { cause });
      }
    }

    let text: string;
    try {
      text = await readBodyText(response, maxBytes, signal);
    } catch (cause) {
      throw failure(action, url, cause);
    }

    try {
      return JSON.parse(text) as unknown;
    } catch (cause) {
      throw new JsonBodyError("Response body is not valid JSON", { cause });
    }
  } finally {
    cleanup();
  }
}
