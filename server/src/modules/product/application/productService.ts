import type { PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import { ProductNotFoundError, ValidationError } from "../../../shared/errors.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import type { FeeRule } from "../../pricing/domain/pricingEngine.js";
import {
  DEFAULT_SETTLEMENT_POLICY,
  isSettlementPolicy,
  type SettlementPolicy,
} from "../../repayment/domain/settlementPolicy.js";

export interface CreateProductInput {
  productCode: string;
  name: string;
  description?: string | null;
  minAmount: string | number;
  maxAmount: string | number;
  minTermMonths: number;
  maxTermMonths: number;
  ratePercent: number;
  rateUnit: "DAILY" | "MONTHLY" | "ANNUAL";
  calculationMethod: "SIMPLE_INTEREST" | "AMORTIZED" | "COMPOUND" | "CUSTOM";
  repaymentMethod: "INTEREST_ONLY" | "PRINCIPAL_AND_INTEREST" | "PRINCIPAL_ONLY" | "BULLET" | "CUSTOM";
  settlementPolicy?: SettlementPolicy;
  feeRules?: FeeRule[];
}

export type UpdateProductInput = Partial<CreateProductInput> & { status?: string };

/** Terms that define the price of a contract. Changing any of these versions the product. */
const PRICING_FIELDS = [
  "ratePercent",
  "rateUnit",
  "calculationMethod",
  "repaymentMethod",
  "feeRules",
  // What early settlement costs is a priced term, so changing it must create
  // a new version rather than silently rewriting live contracts.
  "settlementPolicy",
] as const;

export class ProductService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService
  ) {}

  async create(input: CreateProductInput, context: AuditContext) {
    const minAmount = Money.fromMajorUnits(input.minAmount);
    const maxAmount = Money.fromMajorUnits(input.maxAmount);
    if (maxAmount.lessThan(minAmount)) {
      throw new ValidationError("maxAmount must be greater than or equal to minAmount");
    }
    if (input.maxTermMonths < input.minTermMonths) {
      throw new ValidationError("maxTermMonths must be greater than or equal to minTermMonths");
    }
    if (input.ratePercent < 0) throw new ValidationError("ratePercent cannot be negative");
    if (input.settlementPolicy && !isSettlementPolicy(input.settlementPolicy)) {
      throw new ValidationError("Unknown settlementPolicy", { settlementPolicy: input.settlementPolicy });
    }

    const product = await this.db.loanProduct.create({
      data: {
        productCode: input.productCode,
        name: input.name,
        description: input.description ?? null,
        minAmountCents: minAmount.toMinorUnits(),
        maxAmountCents: maxAmount.toMinorUnits(),
        minTermMonths: input.minTermMonths,
        maxTermMonths: input.maxTermMonths,
        ratePercent: input.ratePercent,
        rateUnit: input.rateUnit,
        calculationMethod: input.calculationMethod,
        repaymentMethod: input.repaymentMethod,
        settlementPolicy: input.settlementPolicy ?? DEFAULT_SETTLEMENT_POLICY,
        feeRules: JSON.stringify(input.feeRules ?? []),
        version: 1,
        status: "ACTIVE",
      },
    });

    await this.audit.record(context, {
      action: "PRODUCT_CREATED",
      resource: "LoanProduct",
      resourceId: product.id,
      after: product,
    });

    return product;
  }

  /**
   * Changing pricing terms creates a NEW product version and archives the old
   * one rather than editing in place (§12). Existing loans keep pointing at
   * the version they were written against, and their LoanSnapshot is
   * untouched either way — so repricing can never rewrite a live contract.
   */
  async update(id: string, input: UpdateProductInput, context: AuditContext) {
    const existing = await this.db.loanProduct.findUnique({ where: { id } });
    if (!existing) throw new ProductNotFoundError(id);

    const changesPricing = PRICING_FIELDS.some((field) => {
      if (input[field] === undefined) return false;
      if (field === "feeRules") return JSON.stringify(input.feeRules) !== existing.feeRules;
      return input[field] !== (existing as Record<string, unknown>)[field];
    });

    if (!changesPricing) {
      const updated = await this.db.loanProduct.update({
        where: { id },
        data: {
          name: input.name ?? existing.name,
          description: input.description !== undefined ? input.description : existing.description,
          minAmountCents:
            input.minAmount !== undefined
              ? Money.fromMajorUnits(input.minAmount).toMinorUnits()
              : existing.minAmountCents,
          maxAmountCents:
            input.maxAmount !== undefined
              ? Money.fromMajorUnits(input.maxAmount).toMinorUnits()
              : existing.maxAmountCents,
          minTermMonths: input.minTermMonths ?? existing.minTermMonths,
          maxTermMonths: input.maxTermMonths ?? existing.maxTermMonths,
          status: input.status ?? existing.status,
        },
      });

      await this.audit.record(context, {
        action: "PRODUCT_UPDATED",
        resource: "LoanProduct",
        resourceId: id,
        before: existing,
        after: updated,
        metadata: { versioned: false },
      });

      return updated;
    }

    const newVersion = await this.db.$transaction(async (tx) => {
      const created = await tx.loanProduct.create({
        data: {
          productCode: existing.productCode,
          name: input.name ?? existing.name,
          description: input.description !== undefined ? input.description : existing.description,
          minAmountCents:
            input.minAmount !== undefined
              ? Money.fromMajorUnits(input.minAmount).toMinorUnits()
              : existing.minAmountCents,
          maxAmountCents:
            input.maxAmount !== undefined
              ? Money.fromMajorUnits(input.maxAmount).toMinorUnits()
              : existing.maxAmountCents,
          minTermMonths: input.minTermMonths ?? existing.minTermMonths,
          maxTermMonths: input.maxTermMonths ?? existing.maxTermMonths,
          ratePercent: input.ratePercent ?? existing.ratePercent,
          rateUnit: input.rateUnit ?? existing.rateUnit,
          calculationMethod: input.calculationMethod ?? existing.calculationMethod,
          repaymentMethod: input.repaymentMethod ?? existing.repaymentMethod,
          settlementPolicy: input.settlementPolicy ?? existing.settlementPolicy,
          feeRules: input.feeRules ? JSON.stringify(input.feeRules) : existing.feeRules,
          version: existing.version + 1,
          status: "ACTIVE",
        },
      });

      await tx.loanProduct.update({ where: { id }, data: { status: "ARCHIVED" } });

      await this.audit.record(
        context,
        {
          action: "PRODUCT_UPDATED",
          resource: "LoanProduct",
          resourceId: created.id,
          before: existing,
          after: created,
          metadata: { versioned: true, previousProductId: id, newVersion: created.version },
        },
        tx
      );

      return created;
    });

    return newVersion;
  }

  async getById(id: string) {
    const product = await this.db.loanProduct.findUnique({ where: { id } });
    if (!product) throw new ProductNotFoundError(id);
    return product;
  }

  async list(params: { status?: string } = {}) {
    return this.db.loanProduct.findMany({
      where: params.status ? { status: params.status } : {},
      orderBy: [{ productCode: "asc" }, { version: "desc" }],
    });
  }
}
