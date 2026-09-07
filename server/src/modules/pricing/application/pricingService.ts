import type { PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import { ApplicationNotFoundError } from "../../../shared/errors.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import { PricingEngine, type FeeRule } from "../domain/pricingEngine.js";
import type { RiskGrade } from "../../risk/domain/riskEngine.js";
import type { CalculationMethod, RateUnit } from "../../repayment/domain/interestEngine.js";
import type { RepaymentMethod, TermUnit } from "../../repayment/domain/repaymentEngine.js";
import type { SettlementPolicy } from "../../repayment/domain/settlementPolicy.js";

export interface CreateOfferInput {
  applicationId: string;
  approvedAmount: Money;
  termCount: number;
  riskGrade: RiskGrade;
  collateralValue?: Money | null;
  /** Balance rolled over from an existing loan on the same product. */
  carriedAmount?: Money | null;
}

export class PricingService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService
  ) {}

  async createOffer(input: CreateOfferInput, context: AuditContext) {
    const application = await this.db.lendingApplication.findUnique({
      where: { id: input.applicationId },
      include: { requestedProduct: true },
    });
    if (!application) throw new ApplicationNotFoundError(input.applicationId);

    const product = application.requestedProduct;

    const priced = PricingEngine.priceOffer({
      approvedAmount: input.approvedAmount,
      termCount: input.termCount,
      riskGrade: input.riskGrade,
      collateralValue: input.collateralValue ?? null,
      carriedAmount: input.carriedAmount ?? null,
      product: {
        id: product.id,
        ratePercent: product.ratePercent,
        rateUnit: product.rateUnit as RateUnit,
        calculationMethod: product.calculationMethod as CalculationMethod,
        repaymentMethod: product.repaymentMethod as RepaymentMethod,
        minAmount: Money.fromMinorUnits(product.minAmountCents),
        maxAmount: Money.fromMinorUnits(product.maxAmountCents),
        minTermCount: product.minTermCount,
        maxTermCount: product.maxTermCount,
        termUnit: product.termUnit as TermUnit,
        feeRules: JSON.parse(product.feeRules) as FeeRule[],
        settlementPolicy: product.settlementPolicy as SettlementPolicy,
      },
    });

    const offer = await this.db.loanOffer.create({
      data: {
        applicationId: application.id,
        productId: product.id,
        approvedAmountCents: priced.approvedAmount.toMinorUnits(),
        ratePercent: priced.ratePercent,
        rateUnit: priced.rateUnit,
        calculationMethod: priced.calculationMethod,
        termCount: priced.termCount,
        termUnit: priced.termUnit,
        feesCents: priced.totalFees.toMinorUnits(),
        repaymentMethod: priced.repaymentMethod,
        settlementPolicy: priced.settlementPolicy,
        totalInterestCents: priced.totalInterest.toMinorUnits(),
        totalPayableCents: priced.totalPayable.toMinorUnits(),
        pricingVersion: priced.pricingVersion,
      },
    });

    await this.audit.record(context, {
      action: "LOAN_OFFER_CREATED",
      resource: "LoanOffer",
      resourceId: offer.id,
      after: {
        approvedAmount: priced.approvedAmount.toMajorUnitsString(),
        ratePercent: priced.ratePercent,
        termCount: priced.termCount,
        totalPayable: priced.totalPayable.toMajorUnitsString(),
      },
      metadata: { applicationId: application.id, pricingVersion: priced.pricingVersion },
    });

    return offer;
  }
}
