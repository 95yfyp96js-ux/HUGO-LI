import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./infrastructure/prisma.js";
import { SystemClock, type Clock } from "./shared/clock.js";
import { resolveJwtSecret } from "./config/security.js";
import { AuditService } from "./modules/audit/application/auditService.js";
import { CustomerService } from "./modules/customer/application/customerService.js";
import { Customer360Service } from "./modules/customer/application/customer360Service.js";
import { RiskService } from "./modules/risk/application/riskService.js";
import { PricingService } from "./modules/pricing/application/pricingService.js";
import { LendingApplicationService } from "./modules/application/application/lendingApplicationService.js";
import { ApprovalService } from "./modules/application/application/approvalService.js";
import { LoanService } from "./modules/loan/application/loanService.js";
import { PaymentService } from "./modules/payment/application/paymentService.js";
import { CollectionService } from "./modules/collection/application/collectionService.js";
import { RenewalService } from "./modules/renewal/application/renewalService.js";
import { PortfolioService } from "./modules/portfolio/application/portfolioService.js";
import { ProductService } from "./modules/product/application/productService.js";
import { AuthService } from "./modules/auth/application/authService.js";
import {
  MockDisbursementProvider,
  type DisbursementProvider,
} from "./modules/disbursement/domain/disbursementProvider.js";
import { MockIdentityScanner, type IdentityScanner } from "./modules/customer/domain/identityScanner.js";

export interface Container {
  db: PrismaClient;
  clock: Clock;
  audit: AuditService;
  auth: AuthService;
  customers: CustomerService;
  customer360: Customer360Service;
  applications: LendingApplicationService;
  approvals: ApprovalService;
  risk: RiskService;
  pricing: PricingService;
  loans: LoanService;
  payments: PaymentService;
  collections: CollectionService;
  renewals: RenewalService;
  portfolio: PortfolioService;
  products: ProductService;
  identityScanner: IdentityScanner;
}

export interface ContainerOptions {
  db?: PrismaClient;
  clock?: Clock;
  jwtSecret?: string;
  disbursementProvider?: DisbursementProvider;
  identityScanner?: IdentityScanner;
}

/**
 * Composition root. Everything is constructor-injected — notably the Clock
 * and the DisbursementProvider — so tests can swap in a MockClock and drive
 * the whole lifecycle deterministically.
 */
export function createContainer(options: ContainerOptions = {}): Container {
  const db = options.db ?? defaultPrisma;
  const clock = options.clock ?? new SystemClock();
  // Fails fast in production rather than falling back to a shipped default.
  const jwtSecret = resolveJwtSecret({ explicit: options.jwtSecret });
  const disbursementProvider = options.disbursementProvider ?? new MockDisbursementProvider();
  const identityScanner = options.identityScanner ?? new MockIdentityScanner();

  const audit = new AuditService(db);
  const risk = new RiskService(db, audit, clock);
  const pricing = new PricingService(db, audit);

  return {
    db,
    clock,
    audit,
    auth: new AuthService(db, jwtSecret),
    customers: new CustomerService(db, audit),
    customer360: new Customer360Service(db, clock),
    applications: new LendingApplicationService(db, audit, risk, pricing),
    approvals: new ApprovalService(db, audit),
    risk,
    pricing,
    loans: new LoanService(db, audit, clock, disbursementProvider),
    payments: new PaymentService(db, audit, clock),
    collections: new CollectionService(db, audit, clock),
    renewals: new RenewalService(db, audit, clock, risk, pricing),
    portfolio: new PortfolioService(db, clock),
    products: new ProductService(db, audit),
    identityScanner,
  };
}
