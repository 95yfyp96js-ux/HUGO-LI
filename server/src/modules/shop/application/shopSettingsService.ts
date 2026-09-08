import type { PrismaClient } from "@prisma/client";
import { RateCapExceededError, ValidationError } from "../../../shared/errors.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import { periodRate } from "../../repayment/domain/repaymentEngine.js";
import type { RateUnit } from "../../repayment/domain/interestEngine.js";

const SETTINGS_ID = "default";

/**
 * The shop's one rate ceiling, expressed as a monthly-equivalent percentage
 * so a daily, monthly or annual product rate can all be checked against the
 * same number (via the same periodRate conversion RepaymentEngine already
 * uses to price a schedule — nothing new is invented here).
 *
 * Null means no cap is configured, which is the state a fresh shop starts
 * in; ProductService and ApprovalService both skip the check in that case
 * rather than rejecting everything.
 */
export class ShopSettingsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService
  ) {}

  async getRateCap(): Promise<number | null> {
    const row = await this.db.shopSettings.findUnique({ where: { id: SETTINGS_ID } });
    return row?.maxMonthlyRatePercent ?? null;
  }

  async setRateCap(maxMonthlyRatePercent: number | null, context: AuditContext) {
    if (maxMonthlyRatePercent !== null) {
      if (!Number.isFinite(maxMonthlyRatePercent) || maxMonthlyRatePercent <= 0) {
        throw new ValidationError("maxMonthlyRatePercent must be a positive number, or null to clear it");
      }
    }

    const before = await this.getRateCap();
    const updated = await this.db.shopSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, maxMonthlyRatePercent, updatedBy: context.userId },
      update: { maxMonthlyRatePercent, updatedBy: context.userId },
    });

    await this.audit.record(context, {
      action: "SHOP_RATE_CAP_UPDATED",
      resource: "ShopSettings",
      resourceId: SETTINGS_ID,
      before: { maxMonthlyRatePercent: before },
      after: { maxMonthlyRatePercent: updated.maxMonthlyRatePercent },
    });

    return { maxMonthlyRatePercent: updated.maxMonthlyRatePercent };
  }

  /**
   * Converts (ratePercent, rateUnit) to its monthly-equivalent and checks it
   * against the configured cap. A no-op when no cap is set. Existing
   * LoanSnapshots are never revisited by this — it only gates what may be
   * newly saved or approved.
   */
  async assertWithinCap(ratePercent: number, rateUnit: RateUnit): Promise<void> {
    const cap = await this.getRateCap();
    if (cap === null) return;
    const monthlyEquivalent = periodRate(ratePercent, rateUnit, "MONTH");
    if (monthlyEquivalent > cap) {
      throw new RateCapExceededError(monthlyEquivalent, cap);
    }
  }
}
