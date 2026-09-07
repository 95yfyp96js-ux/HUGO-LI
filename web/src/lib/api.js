export class ApiRequestError extends Error {
    code;
    details;
    status;
    constructor(status, body) {
        super(body.message);
        this.status = status;
        this.code = body.code;
        this.details = body.details ?? {};
    }
}
const TOKEN_KEY = "lending-os-token";
export const tokenStore = {
    get: () => localStorage.getItem(TOKEN_KEY),
    set: (token) => localStorage.setItem(TOKEN_KEY, token),
    clear: () => localStorage.removeItem(TOKEN_KEY),
};
/**
 * Single entry point to the API. Every response is either data or a
 * DomainError-shaped {code, message, details}, so the UI never has to guess
 * what went wrong from an HTTP status alone.
 */
export async function api(path, options = {}) {
    const url = new URL(path, window.location.origin);
    for (const [key, value] of Object.entries(options.query ?? {})) {
        if (value !== undefined && value !== "")
            url.searchParams.set(key, String(value));
    }
    const headers = { "Content-Type": "application/json" };
    const token = tokenStore.get();
    if (token)
        headers.Authorization = `Bearer ${token}`;
    if (options.idempotencyKey)
        headers["Idempotency-Key"] = options.idempotencyKey;
    const response = await fetch(url.toString(), {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.status === 401) {
        tokenStore.clear();
        if (!window.location.pathname.startsWith("/login"))
            window.location.href = "/login";
    }
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
        throw new ApiRequestError(response.status, payload);
    }
    return payload;
}
/** Idempotency keys are generated per user action, not per retry. */
export function newIdempotencyKey() {
    return crypto.randomUUID();
}
