import type { NextFunction, Request, Response } from "express";
import { DomainError } from "../shared/errors.js";
import type { Clock } from "../shared/clock.js";

/**
 * A small fixed-window rate limiter.
 *
 * It is deliberately hand-rolled rather than pulled from a package: it takes
 * the injected Clock, so window-expiry behaviour is tested by advancing time
 * rather than by sleeping, and the key function can be chosen per route
 * (caller identity for financial writes, source address for login).
 *
 * State lives in this process's memory. That is sufficient for the
 * single-instance deployment this system targets today; running more than
 * one instance needs a shared store, and the limit becomes per-instance
 * until then. This is called out in docs/security.md rather than left for
 * someone to discover in production.
 */
export interface RateLimitOptions {
  /** Requests permitted per window. */
  limit: number;
  windowMs: number;
  /** What is being limited — chooses the bucket. */
  keyFn: (req: Request) => string;
  clock: Clock;
  /** Names the limit in logs and error details, never the key's value. */
  name: string;
}

export class RateLimitedError extends DomainError {
  constructor(name: string, retryAfterSeconds: number) {
    super(
      "RATE_LIMITED",
      "Too many requests. Please wait and try again.",
      429,
      // Deliberately no account, email or key: a rate-limit response must not
      // become an oracle for which accounts exist.
      { limit: name, retryAfterSeconds }
    );
  }
}

interface Bucket {
  count: number;
  windowStartedAt: number;
}

export interface RateLimiter {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  reset: () => void;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const buckets = new Map<string, Bucket>();

  function prune(now: number): void {
    // Cheap sweep so an unbounded key space (source addresses) cannot grow
    // the map forever.
    if (buckets.size < 1000) return;
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStartedAt >= options.windowMs) buckets.delete(key);
    }
  }

  return {
    reset: () => buckets.clear(),
    middleware(req: Request, _res: Response, next: NextFunction) {
      const now = options.clock.now().getTime();
      const key = options.keyFn(req);
      prune(now);

      const bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStartedAt >= options.windowMs) {
        buckets.set(key, { count: 1, windowStartedAt: now });
        return next();
      }

      bucket.count += 1;
      if (bucket.count > options.limit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((bucket.windowStartedAt + options.windowMs - now) / 1000)
        );
        return next(new RateLimitedError(options.name, retryAfterSeconds));
      }

      next();
    },
  };
}

/** Source address, used where the caller is not yet authenticated. */
export function byIp(req: Request): string {
  return req.ip ?? "unknown";
}

/** The acting user, so one user's burst cannot exhaust everyone else's budget. */
export function byUser(req: Request): string {
  return req.user?.id ?? byIp(req);
}

export interface RateLimitSettings {
  /** Unauthenticated authentication attempts. */
  auth: { limit: number; windowMs: number };
  /** Money-moving writes: disburse, pay, reverse, settle, renew, extend. */
  financial: { limit: number; windowMs: number };
  /** Configuration writes: products, permissions. */
  admin: { limit: number; windowMs: number };
}

/**
 * Defaults sized for a back office of a handful of staff. They stop scripted
 * abuse without tripping ordinary work; an internet-facing deployment should
 * tighten `auth` further and put a limiter in front of the process as well.
 */
export const DEFAULT_RATE_LIMITS: RateLimitSettings = {
  auth: { limit: 30, windowMs: 15 * 60 * 1000 },
  financial: { limit: 60, windowMs: 60 * 1000 },
  admin: { limit: 30, windowMs: 60 * 1000 },
};
