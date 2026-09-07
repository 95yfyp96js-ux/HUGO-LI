import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { DomainError, isUniqueConstraintViolation } from "../shared/errors.js";

/**
 * Payload guard for endpoints that take an Idempotency-Key.
 *
 * This is deliberately *not* the thing that stops double spending, and it is
 * deliberately not what answers a retry:
 *
 *   - Not double spending: the unique columns on Payment, Disbursement,
 *     Renewal and Extension do that, in the same transaction as the money,
 *     which is the only place a guarantee can live.
 *   - Not the replay: each service already returns its own original result
 *     with an accurate `replayed` flag. Answering from a cached response here
 *     would mean serving a body whose `replayed: false` had become a lie.
 *
 * What this adds is the one case neither of those can see: a client reusing a
 * key it already used for a *different* request. Without it, "retry the 500
 * payment" and "pay 5,000 under the same key" are indistinguishable, and the
 * second silently receives the first one's answer — the client believes 5,000
 * was paid when 500 was. So a mismatched fingerprint is refused outright, and
 * everything else falls through to the service and its constraints.
 *
 * Only the fingerprint is stored. Request and response bodies carry customer
 * data and amounts, and keeping copies of them here would be a second, weaker
 * store of personal data that nothing reads.
 */
export class IdempotencyGuard {
  constructor(private readonly db: PrismaClient) {}

  /** Stable across key ordering, so a reserialised body is still the same request. */
  static fingerprint(method: string, endpoint: string, body: unknown): string {
    return createHash("sha256").update(`${method} ${endpoint} ${canonicalise(body)}`).digest("hex");
  }

  readonly middleware = (req: Request, res: Response, next: NextFunction): void => {
    const key = req.header("Idempotency-Key");
    if (!key) {
      // An absent key is the route's business, not ours: requireIdempotencyKey
      // rejects it where one is required.
      next();
      return;
    }

    const endpoint = `${req.method} ${req.baseUrl}${req.path}`;
    const fingerprint = IdempotencyGuard.fingerprint(req.method, endpoint, req.body);

    void this.db.idempotencyRecord
      .findUnique({ where: { key } })
      .then(async (existing) => {
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            throw new DomainError(
              "IDEMPOTENCY_KEY_REUSED",
              "This Idempotency-Key was already used for a different request",
              409,
              { idempotencyKey: key, endpoint: existing.endpoint }
            );
          }
          // Same request as before: the service replays it authoritatively.
          next();
          return;
        }

        try {
          await this.db.idempotencyRecord.create({
            data: { key, endpoint, fingerprint, responseBody: "" },
          });
        } catch (error) {
          // A concurrent request with the same key registered first. If it was
          // the same request, it is a legitimate race and the domain
          // constraint decides who does the work; if it was a different one,
          // that request is the reuse and this one must still be refused.
          if (!isUniqueConstraintViolation(error)) throw error;
          const winner = await this.db.idempotencyRecord.findUnique({ where: { key } });
          if (winner && winner.fingerprint !== fingerprint) {
            throw new DomainError(
              "IDEMPOTENCY_KEY_REUSED",
              "This Idempotency-Key was already used for a different request",
              409,
              { idempotencyKey: key, endpoint: winner.endpoint }
            );
          }
        }
        next();
      })
      .catch(next);
  };
}

/**
 * Order-independent JSON, so `{a,b}` and `{b,a}` fingerprint identically and a
 * client is not refused for having reserialised its own request.
 */
function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(",")}}`;
}
