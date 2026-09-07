import type { Prisma, PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import { CustomerNotFoundError, ValidationError } from "../../../shared/errors.js";
import { formatSequenceNumber } from "../../../shared/ids.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";

export interface CreateCustomerInput {
  name: string;
  identityNumber: string;
  dateOfBirth: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  employmentStatus?: string | null;
  employer?: string | null;
  monthlyIncome?: string | number | null;
}

export type UpdateCustomerInput = Partial<CreateCustomerInput> & { status?: string };

const CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE", "BLOCKED", "ARCHIVED"];

export class CustomerService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService
  ) {}

  async create(input: CreateCustomerInput, context: AuditContext) {
    if (!input.name?.trim()) throw new ValidationError("name is required");
    if (!input.identityNumber?.trim()) throw new ValidationError("identityNumber is required");
    if (!input.phone?.trim()) throw new ValidationError("phone is required");

    const existing = await this.db.customer.findUnique({
      where: { identityNumber: input.identityNumber },
    });
    if (existing) {
      throw new ValidationError("A customer with this identity number already exists", {
        customerId: existing.id,
      });
    }

    const sequence = (await this.db.customer.count()) + 1;

    const customer = await this.db.customer.create({
      data: {
        customerNumber: formatSequenceNumber("CUS", sequence),
        name: input.name.trim(),
        identityNumber: input.identityNumber.trim(),
        dateOfBirth: new Date(input.dateOfBirth),
        phone: input.phone.trim(),
        email: input.email ?? null,
        address: input.address ?? null,
        employmentStatus: input.employmentStatus ?? null,
        employer: input.employer ?? null,
        monthlyIncomeCents: toCentsOrNull(input.monthlyIncome),
        createdById: context.userId,
      },
    });

    await this.audit.record(context, {
      action: "CUSTOMER_CREATED",
      resource: "Customer",
      resourceId: customer.id,
      after: customer,
    });

    return customer;
  }

  async update(id: string, input: UpdateCustomerInput, context: AuditContext) {
    const before = await this.db.customer.findUnique({ where: { id } });
    if (!before) throw new CustomerNotFoundError(id);

    if (input.status && !CUSTOMER_STATUSES.includes(input.status)) {
      throw new ValidationError(`status must be one of ${CUSTOMER_STATUSES.join(", ")}`);
    }

    const data: Prisma.CustomerUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.email !== undefined) data.email = input.email;
    if (input.address !== undefined) data.address = input.address;
    if (input.employmentStatus !== undefined) data.employmentStatus = input.employmentStatus;
    if (input.employer !== undefined) data.employer = input.employer;
    if (input.dateOfBirth !== undefined) data.dateOfBirth = new Date(input.dateOfBirth);
    if (input.monthlyIncome !== undefined) data.monthlyIncomeCents = toCentsOrNull(input.monthlyIncome);
    if (input.status !== undefined) data.status = input.status;
    // identityNumber is deliberately NOT updatable: it is the customer's
    // identity anchor and changing it would break KYC traceability.

    const after = await this.db.customer.update({ where: { id }, data });

    await this.audit.record(context, {
      action: "CUSTOMER_UPDATED",
      resource: "Customer",
      resourceId: id,
      before,
      after,
    });

    return after;
  }

  async getById(id: string) {
    const customer = await this.db.customer.findUnique({ where: { id } });
    if (!customer) throw new CustomerNotFoundError(id);
    return customer;
  }

  /** Search across the identifiers staff actually have to hand. */
  async search(params: { query?: string; status?: string; take?: number; skip?: number }) {
    const where: Prisma.CustomerWhereInput = {};
    if (params.status) where.status = params.status;

    const query = params.query?.trim();
    if (query) {
      where.OR = [
        { name: { contains: query } },
        { customerNumber: { contains: query } },
        { phone: { contains: query } },
        { identityNumber: { contains: query } },
        { loans: { some: { loanNumber: { contains: query } } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.db.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: params.take ?? 25,
        skip: params.skip ?? 0,
        include: {
          loans: {
            select: {
              id: true,
              status: true,
              outstandingPrincipalCents: true,
              outstandingInterestCents: true,
              outstandingFeeCents: true,
            },
          },
        },
      }),
      this.db.customer.count({ where }),
    ]);

    return {
      items: items.map((customer) => {
        const activeLoans = customer.loans.filter((l) =>
          ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"].includes(l.status)
        );
        const outstanding = Money.sum(
          activeLoans.map((l) =>
            Money.fromMinorUnits(
              l.outstandingPrincipalCents + l.outstandingInterestCents + l.outstandingFeeCents
            )
          )
        );
        const { loans, ...rest } = customer;
        void loans;
        return {
          ...rest,
          activeLoanCount: activeLoans.length,
          overdueLoanCount: customer.loans.filter((l) => l.status === "OVERDUE").length,
          totalOutstanding: outstanding.toMajorUnitsString(),
        };
      }),
      total,
    };
  }
}

export function toCentsOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  return Money.fromMajorUnits(value).toMinorUnits();
}
