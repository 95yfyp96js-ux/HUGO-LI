import { IS_SNAPSHOT, lookup } from "./snapshot";

export interface ApiError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly status: number;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details ?? {};
  }
}

const TOKEN_KEY = "lending-os-token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

interface RequestOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  query?: Record<string, string | number | boolean | undefined>;
}

/**
 * Single entry point to the API. Every response is either data or a
 * DomainError-shaped {code, message, details}, so the UI never has to guess
 * what went wrong from an HTTP status alone.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  // Static preview build: serve recorded responses instead of calling an API.
  if (IS_SNAPSHOT) {
    return lookup(options.method ?? "GET", `${url.pathname}${url.search}`) as T;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401) {
    tokenStore.clear();
    if (!window.location.pathname.startsWith("/login")) window.location.href = "/login";
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiRequestError(response.status, payload as ApiError);
  }
  return payload as T;
}

/** Idempotency keys are generated per user action, not per retry. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
