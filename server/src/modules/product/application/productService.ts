import type { PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import { ProductNotFoundError, ValidationError } from "../../../shared/errors.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import type { FeeRule } from "../../pricing/domain/pricingEngine.js";
import type { TermUnit } from "../../repayment/domain/repaymentEngine.js";
import {
  DEFAULT_SETTLEMENT_POLICY,
  isSettlementPolicy,
  type SettlementPolicy,
} from "../../repayment/domain/settlementPolicy.js";
import type { ShopSettingsService } from "../../shop/application/shopSettingsService.js";

export interface CreateProductInput {
  productCode: string;
  name: string;
  description?: string | null;
  minAmount: string | number;
  maxAmount: string | number;
  minTermCount: number;
  maxTermCount: number;
  /** Whether the term counts are days or months. */
  termUnit?: TermUnit;
  ratePercent: number;
  rateUnit: "DAILY" | "MONTHLY" | "ANNUAL";
  /**
   * Only simple interest is offered. Amortised and compound schedules are
   * modelled in the engines but are not exposed as product options, so no
   * product can be configured onto a calculation the business has not agreed
   * to price and disclose.
   */
  calculationMethod?: "SIMPLE_INTEREST";
  repaymentMethod: "INTEREST_ONLY" | "PRINCIPAL_AND_INTEREST" | "PRINCIPAL_ONLY" | "BULLET" | "CUSTOM";
  settlementPolicy?: SettlementPolicy;
  feeRules?: FeeRule[];
}

export type UpdateProductInput = Partial<CreateProductInput> & { status?: string };

/**
 * Terms a borrower was quoted on. Changing any of them creates a new product
 * version rather than editing in place.
 *
 * The amount and term bounds are in this list deliberately. They decide who
 * could have been offered the product at all, so moving them silently would
 * make the historical record of an offer unreconstructable — a loan would
 * appear to have been written outside limits that were different at the time.
 * Only presentation (name, description) and lifecycle (status) can be edited
 * without a version.
 */
const VERSIONED_FIELDS = [
  "ratePercent",
  "rateUnit",
  "calculationMethod",
  "repaymentMethod",
  "feeRules",
  // What early settlement costs is a priced term, so changing it must create
  // a new version rather than silently rewriting live contracts.
  "settlementPolicy",
  "minAmount",
  "maxAmount",
  "minTermCount",
  "maxTermCount",
  "termUnit",
] as const;

function isTermUnit(value: string): value is TermUnit {
  return value === "DAY" || value === "MONTH";
}

export class ProductService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService,
    private readonly shopSettings: ShopSettingsService
  ) {}

  async create(input: CreateProductInput, context: AuditContext) {
    const minAmount = Money.fromMajorUnits(input.minAmount);
    const maxAmount = Money.fromMajorUnits(input.maxAmount);
    if (maxAmount.lessThan(minAmount)) {
      throw new ValidationError("maxAmount must be greater than or equal to minAmount");
    }
    if (input.maxTermCount < input.minTermCount) {
      throw new ValidationError("maxTermCount must be greater than or equal to minTermCount");
    }
    if (input.ratePercent < 0) throw new ValidationError("ratePercent cannot be negative");
    if (input.minTermCount < 1) throw new ValidationError("minTermCount must be at least 1");
    if (input.termUnit && !isTermUnit(input.termUnit)) {
      throw new ValidationError("termUnit must be DAY or MONTH", { termUnit: input.termUnit });
    }
    if (input.calculationMethod && input.calculationMethod !== "SIMPLE_INTEREST") {
      throw new ValidationError("Only SIMPLE_INTEREST products may be offered", {
        calculationMethod: input.calculationMethod,
      });
    }
    if (input.settlementPolicy && !isSettlementPolicy(input.settlementPolicy)) {
      throw new ValidationError("Unknown settlementPolicy", { settlementPolicy: input.settlementPolicy });
    }
    if (!input.productCode?.trim()) throw new ValidationError("productCode is required");
    if (!input.name?.trim()) throw new ValidationError("name is required");
    if (!input.repaymentMethod) throw new ValidationError("repaymentMethod is required");

    // Shop-wide rate ceiling (店規). Checked before anything is written, not
    // after — a product that fails this must not exist even transiently.
    await this.shopSettings.assertWithinCap(input.ratePercent, input.rateUnit);

    // A new product always starts at version 1, so a repeated code collides
    // with the unique (productCode, version) index. Checked up front for a
    // clear message rather than surfacing the raw constraint error.
    const existingCode = await this.db.loanProduct.findFirst({
      where: { productCode: input.productCode },
    });
    if (existingCode) {
      throw new ValidationError("A product with this code already exists", {
        productCode: input.productCode,
      });
    }

    const product = await this.db.loanProduct.create({
      data: {
        productCode: input.productCode,
        name: input.name,
        description: input.description ?? null,
        minAmountCents: minAmount.toMinorUnits(),
        maxAmountCents: maxAmount.toMinorUnits(),
        minTermCount: input.minTermCount,
        maxTermCount: input.maxTermCount,
        termUnit: input.termUnit ?? "MONTH",
        ratePercent: input.ratePercent,
        rateUnit: input.rateUnit,
        calculationMethod: "SIMPLE_INTEREST",
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

    if (input.calculationMethod && input.calculationMethod !== "SIMPLE_INTEREST") {
      throw new ValidationError("Only SIMPLE_INTEREST products may be offered", {
        calculationMethod: input.calculationMethod,
      });
    }
    if (input.termUnit && !isTermUnit(input.termUnit)) {
      throw new ValidationError("termUnit must be DAY or MONTH", { termUnit: input.termUnit });
    }

    const changesTerms = VERSIONED_FIELDS.some((field) => {
      if (input[field] === undefined) return false;
      if (field === "feeRules") return JSON.stringify(input.feeRules) !== existing.feeRules;
      // Amounts are compared in minor units so 1000 and "1000.00" are the
      // same value rather than a spurious new version.
      if (field === "minAmount") {
        return Money.fromMajorUnits(input.minAmount!).toMinorUnits() !== existing.minAmountCents;
      }
      if (field === "maxAmount") {
        return Money.fromMajorUnits(input.maxAmount!).toMinorUnits() !== existing.maxAmountCents;
      }
      return input[field] !== (existing as Record<string, unknown>)[field];
    });

    if (!changesTerms) {
      const updated = await this.db.loanProduct.update({
        where: { id },
        // Nothing here changes what anyone was quoted, so it edits in place.
        data: {
          name: input.name ?? existing.name,
          description: input.description !== undefined ? input.description : existing.description,
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

    // Shop-wide rate ceiling (店規), checked against the version actually
    // being written — not the one it replaces.
    await this.shopSettings.assertWithinCap(
      input.ratePercent ?? existing.ratePercent,
      (input.rateUnit ?? existing.rateUnit) as CreateProductInput["rateUnit"]
    );

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
          minTermCount: input.minTermCount ?? existing.minTermCount,
          maxTermCount: input.maxTermCount ?? existing.maxTermCount,
          termUnit: input.termUnit ?? existing.termUnit,
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
