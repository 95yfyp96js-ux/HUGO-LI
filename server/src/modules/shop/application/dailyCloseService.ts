import type { Prisma, PrismaClient } from "@prisma/client";
import { DailyCloseLockedError, ValidationError } from "../../../shared/errors.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import { resolveTaipeiDay } from "../../../shared/taipeiDay.js";

export type DailyCloseStatus = "OPEN" | "CLOSED" | "REOPENED";

/**
 * Whether a given Asia/Taipei calendar day currently blocks new financial
 * writes dated into it. Exported as a plain function — taking either the
 * PrismaClient or a $transaction client — so PaymentService and LoanService
 * can call it directly at the moment they are about to write, inside the
 * same transaction, without a constructor dependency on DailyCloseService.
 *
 * Absence of a row means open; a row only ever exists once a day has been
 * closed at least once.
 */
export async function assertDayOpen(
  db: PrismaClient | Prisma.TransactionClient,
  instant: Date
): Promise<void> {
  const { label } = resolveTaipeiDay(undefined, instant);
  const row = await db.dailyClose.findUnique({ where: { date: label } });
  if (row && row.status === "CLOSED") {
    throw new DailyCloseLockedError(label);
  }
}

/**
 * Manager-facing close/reopen of one day's books. Closing refuses new
 * payments, reversals and disbursements dated into that day (enforced at
 * write time by assertDayOpen above, called from inside each of those
 * services); it does not touch anything already written. Reopening always
 * requires a reason, and both directions are audited — the DailyClose row
 * itself only reflects current status, the audit log carries the history.
 */
export class DailyCloseService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService
  ) {}

  async getStatus(dateInput: string): Promise<{ date: string; status: DailyCloseStatus }> {
    const { label } = resolveTaipeiDay(dateInput, new Date());
    const row = await this.db.dailyClose.findUnique({ where: { date: label } });
    return { date: label, status: (row?.status as DailyCloseStatus) ?? "OPEN" };
  }

  async close(dateInput: string, context: AuditContext) {
    const { label } = resolveTaipeiDay(dateInput, new Date());
    const existing = await this.db.dailyClose.findUnique({ where: { date: label } });

    const row = await this.db.dailyClose.upsert({
      where: { date: label },
      create: { date: label, status: "CLOSED", closedBy: context.userId },
      update: {
        status: "CLOSED",
        closedAt: new Date(),
        closedBy: context.userId,
        reopenedAt: null,
        reopenedBy: null,
        reopenReason: null,
      },
    });

    await this.audit.record(context, {
      action: "DAILY_CLOSE_CLOSED",
      resource: "DailyClose",
      resourceId: label,
      before: { status: existing?.status ?? "OPEN" },
      after: { status: "CLOSED" },
    });

    return row;
  }

  async reopen(dateInput: string, reason: string, context: AuditContext) {
    if (!reason?.trim()) throw new ValidationError("A reason is required to reopen a closed day");
    const { label } = resolveTaipeiDay(dateInput, new Date());
    const existing = await this.db.dailyClose.findUnique({ where: { date: label } });
    if (!existing || existing.status !== "CLOSED") {
      throw new ValidationError(`${label} is not currently closed`, { date: label });
    }

    const row = await this.db.dailyClose.update({
      where: { date: label },
      data: {
        status: "REOPENED",
        reopenedAt: new Date(),
        reopenedBy: context.userId,
        reopenReason: reason,
      },
    });

    await this.audit.record(context, {
      action: "DAILY_CLOSE_REOPENED",
      resource: "DailyClose",
      resourceId: label,
      before: { status: "CLOSED" },
      after: { status: "REOPENED" },
      reason,
    });

    return row;
  }
}
