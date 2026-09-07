import type { Prisma, PrismaClient } from "@prisma/client";

export type AuditAction =
  | "CUSTOMER_CREATED"
  | "CUSTOMER_UPDATED"
  | "APPLICATION_CREATED"
  | "APPLICATION_SUBMITTED"
  | "APPLICATION_APPROVED"
  | "APPLICATION_REJECTED"
  | "RISK_ASSESSMENT_CREATED"
  | "LENDING_LIMIT_CALCULATED"
  | "LOAN_OFFER_CREATED"
  | "LOAN_CREATED"
  | "LOAN_APPROVED"
  | "LOAN_DISBURSED"
  | "INTEREST_ACCRUED"
  | "PAYMENT_CREATED"
  | "PAYMENT_REVERSED"
  | "COLLECTION_CASE_CREATED"
  | "COLLECTION_ACTIVITY_CREATED"
  | "PROMISE_TO_PAY_CREATED"
  | "RENEWAL_CREATED"
  | "EXTENSION_CREATED"
  | "SETTLEMENT_CREATED"
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "PERMISSION_UPDATED";

export interface AuditContext {
  userId: string | null;
  ip?: string | null;
}

export interface AuditWriteInput {
  action: AuditAction;
  resource: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fields that must never be written into an audit payload in the clear. */
const SENSITIVE_KEYS = new Set(["identityNumber", "passwordHash", "password", "token"]);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key) ? "[REDACTED]" : redact(val);
    }
    return out;
  }
  return value;
}

function serialise(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(redact(value));
}

/**
 * AuditService — every state-changing operation writes here. Audit rows are
 * append-only: there is no update or delete path exposed anywhere in the
 * application.
 *
 * Writes take an optional transaction client so the audit row commits or
 * rolls back atomically with the business change it describes.
 */
export class AuditService {
  constructor(private readonly db: PrismaClient) {}

  async record(
    context: AuditContext,
    input: AuditWriteInput,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const client = tx ?? this.db;
    await client.auditLog.create({
      data: {
        userId: context.userId,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId,
        before: serialise(input.before),
        after: serialise(input.after),
        reason: input.reason ?? null,
        ip: context.ip ?? null,
        metadata: JSON.stringify(redact(input.metadata ?? {})),
      },
    });
  }

  async list(params: {
    resource?: string;
    resourceId?: string;
    userId?: string;
    action?: string;
    take?: number;
    skip?: number;
  }) {
    const where: Prisma.AuditLogWhereInput = {};
    if (params.resource) where.resource = params.resource;
    if (params.resourceId) where.resourceId = params.resourceId;
    if (params.userId) where.userId = params.userId;
    if (params.action) where.action = params.action;

    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: params.take ?? 50,
        skip: params.skip ?? 0,
        include: { user: { select: { id: true, displayName: true, email: true } } },
      }),
      this.db.auditLog.count({ where }),
    ]);

    return { items, total };
  }
}
