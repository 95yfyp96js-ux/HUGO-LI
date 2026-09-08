import { Router } from "express";
import type { Container } from "../container.js";
import { Money } from "../shared/money.js";
import { DomainError, ValidationError } from "../shared/errors.js";
import { maskIdentityNumber } from "../shared/mask.js";
import {
  asyncHandler,
  auditContext,
  authenticate,
  requireIdempotencyKey,
  requirePermission,
} from "./middleware.js";
import {
  DEFAULT_RATE_LIMITS,
  byIp,
  byUser,
  createRateLimiter,
  type RateLimitSettings,
} from "./rateLimit.js";
import { IdempotencyGuard } from "./idempotency.js";

const num = (value: unknown, fallback?: number): number | undefined => {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function createRoutes(
  container: Container,
  rateLimits: RateLimitSettings = DEFAULT_RATE_LIMITS
): Router {
  const router = Router();

  // Login is limited by source address rather than by account: limiting per
  // account would let anyone lock a known user out by guessing at them.
  const authLimit = createRateLimiter({
    ...rateLimits.auth,
    name: "auth",
    keyFn: byIp,
    clock: container.clock,
  });
  // Money-moving and configuration writes are limited per acting user.
  const financialLimit = createRateLimiter({
    ...rateLimits.financial,
    name: "financial",
    keyFn: byUser,
    clock: container.clock,
  });
  // Refuses an Idempotency-Key reused for a different request, and replays a
  // stored response for an identical one. The unique columns on the financial
  // tables remain the actual guarantee; this catches the case they cannot see.
  const idempotency = new IdempotencyGuard(container.db);
  const adminLimit = createRateLimiter({
    ...rateLimits.admin,
    name: "admin",
    keyFn: byUser,
    clock: container.clock,
  });

  // ---------------------------------------------------------------- auth
  router.post(
    "/auth/login",
    authLimit.middleware,
    asyncHandler(async (req, res) => {
      const { email, password } = req.body ?? {};
      if (!email || !password) throw new ValidationError("email and password are required");
      const result = await container.auth.login(email, password);
      res.json(result);
    })
  );

  // Everything below requires a session.
  router.use(authenticate(container));

  router.get(
    "/auth/me",
    asyncHandler(async (req, res) => {
      res.json(req.user);
    })
  );

  // ------------------------------------------------------------ customers
  router.get(
    "/customers",
    requirePermission("CUSTOMER_READ"),
    asyncHandler(async (req, res) => {
      const result = await container.customers.search({
        query: req.query.q as string | undefined,
        status: req.query.status as string | undefined,
        take: num(req.query.take, 25),
        skip: num(req.query.skip, 0),
      });
      res.json({
        ...result,
        items: result.items.map((c) => ({
          ...c,
          identityNumber: maskIdentityNumber(c.identityNumber),
        })),
      });
    })
  );

  router.post(
    "/customers",
    requirePermission("CUSTOMER_CREATE"),
    asyncHandler(async (req, res) => {
      const customer = await container.customers.create(req.body, auditContext(req));
      res.status(201).json({ ...customer, identityNumber: maskIdentityNumber(customer.identityNumber) });
    })
  );

  router.get(
    "/customers/:id",
    requirePermission("CUSTOMER_READ"),
    asyncHandler(async (req, res) => {
      const customer = await container.customers.getById(req.params.id!);
      res.json({ ...customer, identityNumber: maskIdentityNumber(customer.identityNumber) });
    })
  );

  router.patch(
    "/customers/:id",
    requirePermission("CUSTOMER_UPDATE"),
    asyncHandler(async (req, res) => {
      const customer = await container.customers.update(req.params.id!, req.body, auditContext(req));
      res.json({ ...customer, identityNumber: maskIdentityNumber(customer.identityNumber) });
    })
  );

  router.get(
    "/customers/:id/360",
    requirePermission("CUSTOMER_READ"),
    asyncHandler(async (req, res) => {
      res.json(await container.customer360.get(req.params.id!));
    })
  );

  // Scan returns a parsed result for human confirmation — it never writes.
  router.post(
    "/customers/identity-scan",
    requirePermission("CUSTOMER_CREATE"),
    asyncHandler(async (req, res) => {
      const result = await container.identityScanner.scan(req.body ?? {});
      const existing = await container.db.customer.findUnique({
        where: { identityNumber: result.identityNumber },
        select: { id: true, name: true, customerNumber: true },
      });
      res.json({
        scan: result,
        requiresConfirmation: true,
        matchedCustomer: existing,
      });
    })
  );

  // --------------------------------------------------------- applications
  router.get(
    "/lending/applications",
    requirePermission("APPLICATION_READ"),
    asyncHandler(async (req, res) => {
      res.json(
        await container.applications.list({
          status: req.query.status as string | undefined,
          customerId: req.query.customerId as string | undefined,
          take: num(req.query.take, 25),
          skip: num(req.query.skip, 0),
        })
      );
    })
  );

  router.post(
    "/lending/applications",
    requirePermission("APPLICATION_CREATE"),
    asyncHandler(async (req, res) => {
      res.status(201).json(await container.applications.create(req.body, auditContext(req)));
    })
  );

  router.get(
    "/lending/applications/:id",
    requirePermission("APPLICATION_READ"),
    asyncHandler(async (req, res) => {
      res.json(await container.applications.getById(req.params.id!));
    })
  );

  router.patch(
    "/lending/applications/:id",
    requirePermission("APPLICATION_UPDATE"),
    asyncHandler(async (req, res) => {
      res.json(await container.applications.update(req.params.id!, req.body, auditContext(req)));
    })
  );

  router.post(
    "/lending/applications/:id/submit",
    requirePermission("APPLICATION_UPDATE"),
    asyncHandler(async (req, res) => {
      res.json(await container.applications.submit(req.params.id!, auditContext(req)));
    })
  );

  router.post(
    "/lending/applications/:id/approve",
    requirePermission("APPLICATION_APPROVE"),
    asyncHandler(async (req, res) => {
      res.json(await container.approvals.approve(req.params.id!, req.body ?? {}, auditContext(req)));
    })
  );

  router.post(
    "/lending/applications/:id/reject",
    requirePermission("APPLICATION_REJECT"),
    asyncHandler(async (req, res) => {
      const reason = req.body?.reason;
      res.json(await container.approvals.reject(req.params.id!, reason, auditContext(req)));
    })
  );

  router.post(
    "/lending/applications/:id/cancel",
    requirePermission("APPLICATION_UPDATE"),
    asyncHandler(async (req, res) => {
      res.json(
        await container.applications.cancel(req.params.id!, req.body?.reason ?? null, auditContext(req))
      );
    })
  );

  // ----------------------------------------------------------------- loans
  router.get(
    "/loans",
    requirePermission("LOAN_READ"),
    asyncHandler(async (req, res) => {
      res.json(
        await container.loans.list({
          status: req.query.status as string | undefined,
          customerId: req.query.customerId as string | undefined,
          overdueOnly: req.query.overdue === "true",
          pendingDisbursement: req.query.pendingDisbursement === "true",
          take: num(req.query.take, 25),
          skip: num(req.query.skip, 0),
        })
      );
    })
  );

  router.post(
    "/loans",
    requirePermission("LOAN_CREATE"),
    asyncHandler(async (req, res) => {
      const applicationId = req.body?.applicationId;
      if (!applicationId) throw new ValidationError("applicationId is required");
      res
        .status(201)
        .json(await container.loans.createFromApprovedApplication(applicationId, auditContext(req)));
    })
  );

  router.get(
    "/loans/:id",
    requirePermission("LOAN_READ"),
    asyncHandler(async (req, res) => {
      res.json(await container.loans.getById(req.params.id!));
    })
  );

  router.get(
    "/loans/:id/schedule",
    requirePermission("LOAN_READ"),
    asyncHandler(async (req, res) => {
      const lines = await container.db.scheduleLine.findMany({
        where: { loanId: req.params.id! },
        orderBy: { installmentNumber: "asc" },
      });
      res.json({
        items: lines.map((line) => ({
          ...line,
          principalDue: Money.fromMinorUnits(line.principalDueCents).toMajorUnitsString(),
          interestDue: Money.fromMinorUnits(line.interestDueCents).toMajorUnitsString(),
          feeDue: Money.fromMinorUnits(line.feeDueCents).toMajorUnitsString(),
          totalDue: Money.fromMinorUnits(line.totalDueCents).toMajorUnitsString(),
          totalPaid: Money.fromMinorUnits(
            line.principalPaidCents + line.interestPaidCents + line.feePaidCents
          ).toMajorUnitsString(),
        })),
      });
    })
  );

  // Balance is recomputed from the ledger, not read from a cached column.
  router.get(
    "/loans/:id/balance",
    requirePermission("LOAN_READ"),
    asyncHandler(async (req, res) => {
      const balance = await container.loans.recalculateLoanBalance(req.params.id!);
      res.json({
        outstandingPrincipal: balance.outstandingPrincipal.toMajorUnitsString(),
        outstandingInterest: balance.outstandingInterest.toMajorUnitsString(),
        outstandingFees: balance.outstandingFees.toMajorUnitsString(),
        totalOutstanding: balance.totalOutstanding.toMajorUnitsString(),
        totalPaid: balance.totalPaid.toMajorUnitsString(),
        principalPaid: balance.principalPaid.toMajorUnitsString(),
        interestPaid: balance.interestPaid.toMajorUnitsString(),
        feesPaid: balance.feesPaid.toMajorUnitsString(),
      });
    })
  );

  router.get(
    "/loans/:id/events",
    requirePermission("LOAN_READ"),
    asyncHandler(async (req, res) => {
      const events = await container.db.moneyEvent.findMany({
        where: { loanId: req.params.id! },
        orderBy: { occurredAt: "asc" },
      });
      res.json({
        items: events.map((e) => ({
          ...e,
          amount: Money.fromMinorUnits(e.amountCents).toMajorUnitsString(),
          metadata: JSON.parse(e.metadata) as Record<string, unknown>,
        })),
      });
    })
  );

  router.get(
    "/loans/:id/chain",
    requirePermission("LOAN_READ"),
    asyncHandler(async (req, res) => {
      res.json(await container.renewals.getLoanChain(req.params.id!));
    })
  );

  router.post(
    "/loans/:id/disburse",
    financialLimit.middleware,
    idempotency.middleware,
    requirePermission("LOAN_DISBURSE"),
    asyncHandler(async (req, res) => {
      const idempotencyKey = requireIdempotencyKey(req);
      const result = await container.loans.disburse(
        req.params.id!,
        { ...req.body, idempotencyKey },
        auditContext(req)
      );
      res.status(result.replayed ? 200 : 201).json(result);
    })
  );

  router.post(
    "/loans/:id/renew",
    financialLimit.middleware,
    idempotency.middleware,
    requirePermission("LOAN_RENEW"),
    asyncHandler(async (req, res) => {
      const idempotencyKey = requireIdempotencyKey(req);
      const result = await container.renewals.renew(
        req.params.id!,
        { ...req.body, idempotencyKey },
        auditContext(req)
      );
      res.status(result.replayed ? 200 : 201).json(result);
    })
  );

  router.post(
    "/loans/:id/extend",
    financialLimit.middleware,
    idempotency.middleware,
    requirePermission("LOAN_EXTEND"),
    asyncHandler(async (req, res) => {
      const idempotencyKey = requireIdempotencyKey(req);
      const result = await container.renewals.extend(
        req.params.id!,
        { ...req.body, idempotencyKey },
        auditContext(req)
      );
      res.status(result.replayed ? 200 : 201).json(result);
    })
  );

  router.get(
    "/loans/:id/settlement-quote",
    requirePermission("LOAN_READ"),
    asyncHandler(async (req, res) => {
      res.json(await container.payments.settlementQuote(req.params.id!));
    })
  );

  // Settlement here is an explicit final payment for the whole balance.
  router.post(
    "/loans/:id/settle",
    financialLimit.middleware,
    idempotency.middleware,
    requirePermission("LOAN_SETTLE"),
    asyncHandler(async (req, res) => {
      const idempotencyKey = requireIdempotencyKey(req);
      // Refuses rather than charging full contract interest on a loan whose
      // agreed policy promises a rebate.
      await container.payments.assertSettleable(req.params.id!);
      const outstanding = await container.payments.getOutstanding(req.params.id!);
      const total = outstanding.principal.add(outstanding.interest).add(outstanding.fees);
      if (total.isZero()) throw new ValidationError("Loan has no outstanding balance to settle");

      const result = await container.payments.create(
        {
          loanId: req.params.id!,
          amount: total.toMajorUnitsString(),
          method: req.body?.method ?? "SETTLEMENT",
          idempotencyKey,
        },
        auditContext(req)
      );
      res.status(201).json(result);
    })
  );

  router.post(
    "/loans/:id/refresh-status",
    requirePermission("LOAN_READ"),
    asyncHandler(async (req, res) => {
      res.json(await container.loans.refreshDelinquency(req.params.id!, auditContext(req)));
    })
  );

  // -------------------------------------------------------------- payments
  router.get(
    "/payments",
    requirePermission("PAYMENT_READ"),
    asyncHandler(async (req, res) => {
      res.json(
        await container.payments.list({
          loanId: req.query.loanId as string | undefined,
          customerId: req.query.customerId as string | undefined,
          take: num(req.query.take, 25),
          skip: num(req.query.skip, 0),
        })
      );
    })
  );

  // Read-only receivables list, filtered to one calendar day at a time. Every
  // role that can read payments can see this — including AUDITOR, who can
  // look but not register a payment against it.
  router.get(
    "/payments/due-today",
    requirePermission("PAYMENT_READ"),
    asyncHandler(async (req, res) => {
      res.json(await container.payments.dueOn(req.query.date as string | undefined));
    })
  );

  router.post(
    "/payments/preview",
    requirePermission("PAYMENT_READ"),
    asyncHandler(async (req, res) => {
      const { loanId, amount } = req.body ?? {};
      if (!loanId || amount === undefined) throw new ValidationError("loanId and amount are required");
      res.json(await container.payments.previewAllocation(loanId, amount));
    })
  );

  router.post(
    "/payments",
    financialLimit.middleware,
    idempotency.middleware,
    requirePermission("PAYMENT_CREATE"),
    asyncHandler(async (req, res) => {
      const idempotencyKey = requireIdempotencyKey(req);
      const result = await container.payments.create(
        { ...req.body, idempotencyKey },
        auditContext(req)
      );
      res.status(result.replayed ? 200 : 201).json(result);
    })
  );

  router.post(
    "/payments/:id/reverse",
    financialLimit.middleware,
    requirePermission("PAYMENT_REVERSE"),
    asyncHandler(async (req, res) => {
      res.json(await container.payments.reverse(req.params.id!, req.body?.reason, auditContext(req)));
    })
  );

  // ----------------------------------------------------------- collections
  router.get(
    "/collections",
    requirePermission("COLLECTION_READ"),
    asyncHandler(async (req, res) => {
      res.json(
        await container.collections.list({
          status: req.query.status as string | undefined,
          priority: req.query.priority as string | undefined,
          assignedUserId: req.query.assignedUserId as string | undefined,
          take: num(req.query.take, 25),
          skip: num(req.query.skip, 0),
        })
      );
    })
  );

  router.get(
    "/collections/dashboard",
    requirePermission("COLLECTION_READ"),
    asyncHandler(async (_req, res) => {
      res.json(await container.collections.dashboard());
    })
  );

  router.post(
    "/collections/sync",
    requirePermission("COLLECTION_UPDATE"),
    asyncHandler(async (req, res) => {
      res.json(await container.collections.syncCasesForOverdueLoans(auditContext(req)));
    })
  );

  router.get(
    "/collections/:id",
    requirePermission("COLLECTION_READ"),
    asyncHandler(async (req, res) => {
      res.json(await container.collections.getById(req.params.id!));
    })
  );

  router.post(
    "/collections/:id/activity",
    requirePermission("COLLECTION_UPDATE"),
    asyncHandler(async (req, res) => {
      res.status(201).json(
        await container.collections.addActivity(req.params.id!, req.body, auditContext(req))
      );
    })
  );

  router.post(
    "/collections/:id/promise",
    requirePermission("COLLECTION_UPDATE"),
    asyncHandler(async (req, res) => {
      res.status(201).json(
        await container.collections.addPromiseToPay(req.params.id!, req.body, auditContext(req))
      );
    })
  );

  router.post(
    "/collections/:id/assign",
    requirePermission("COLLECTION_UPDATE"),
    asyncHandler(async (req, res) => {
      res.json(
        await container.collections.assign(req.params.id!, req.body?.userId ?? null, auditContext(req))
      );
    })
  );

  router.post(
    "/loans/:id/collection-case",
    requirePermission("COLLECTION_UPDATE"),
    asyncHandler(async (req, res) => {
      res.status(201).json(
        await container.collections.createCaseForLoan(req.params.id!, auditContext(req))
      );
    })
  );

  // -------------------------------------------------------------- renewals
  router.get(
    "/renewals",
    requirePermission("LOAN_READ"),
    asyncHandler(async (req, res) => {
      res.json(
        await container.renewals.listRenewals({
          take: num(req.query.take, 25),
          skip: num(req.query.skip, 0),
        })
      );
    })
  );

  // -------------------------------------------------------------- products
  router.get(
    "/products",
    requirePermission("PRODUCT_READ"),
    asyncHandler(async (req, res) => {
      const products = await container.products.list({ status: req.query.status as string | undefined });
      res.json({
        items: products.map((p) => ({
          ...p,
          minAmount: Money.fromMinorUnits(p.minAmountCents).toMajorUnitsString(),
          maxAmount: Money.fromMinorUnits(p.maxAmountCents).toMajorUnitsString(),
          feeRules: JSON.parse(p.feeRules) as unknown,
        })),
      });
    })
  );

  router.post(
    "/products",
    adminLimit.middleware,
    requirePermission("PRODUCT_UPDATE"),
    asyncHandler(async (req, res) => {
      res.status(201).json(await container.products.create(req.body, auditContext(req)));
    })
  );

  router.get(
    "/products/:id",
    requirePermission("PRODUCT_READ"),
    asyncHandler(async (req, res) => {
      const product = await container.products.getById(req.params.id!);
      res.json({
        ...product,
        minAmount: Money.fromMinorUnits(product.minAmountCents).toMajorUnitsString(),
        maxAmount: Money.fromMinorUnits(product.maxAmountCents).toMajorUnitsString(),
        feeRules: JSON.parse(product.feeRules) as unknown,
      });
    })
  );

  router.patch(
    "/products/:id",
    adminLimit.middleware,
    requirePermission("PRODUCT_UPDATE"),
    asyncHandler(async (req, res) => {
      res.json(await container.products.update(req.params.id!, req.body, auditContext(req)));
    })
  );

  // ------------------------------------------------------------- portfolio
  router.get(
    "/portfolio/summary",
    requirePermission("LOAN_READ"),
    asyncHandler(async (_req, res) => {
      res.json(await container.portfolio.summary());
    })
  );

  router.get(
    "/portfolio/by-risk-grade",
    requirePermission("LOAN_READ"),
    asyncHandler(async (_req, res) => {
      res.json({ items: await container.portfolio.byRiskGrade() });
    })
  );

  router.get(
    "/portfolio/trend",
    requirePermission("LOAN_READ"),
    asyncHandler(async (req, res) => {
      res.json({ items: await container.portfolio.trend(num(req.query.days, 30)) });
    })
  );

  router.get(
    "/dashboard",
    requirePermission("LOAN_READ"),
    asyncHandler(async (_req, res) => {
      const [summary, byGrade, collections, dailyClose] = await Promise.all([
        container.portfolio.summary(),
        container.portfolio.byRiskGrade(),
        container.collections.dashboard(),
        // Today in Asia/Taipei, same figures the 早會 KPIs and the 今日應收
        // page's day-close are built from — one calculation, never two.
        container.payments.dueOn(),
      ]);
      res.json({
        summary,
        byRiskGrade: byGrade,
        collections,
        dailyClose: { date: dailyClose.date, ...dailyClose.summary },
      });
    })
  );

  // ----------------------------------------------------------------- users
  router.get(
    "/settings/users",
    requirePermission("USER_MANAGE"),
    asyncHandler(async (_req, res) => {
      res.json({ items: await container.auth.listUsers() });
    })
  );

  router.get(
    "/settings/roles",
    requirePermission("USER_MANAGE"),
    asyncHandler(async (_req, res) => {
      res.json({ items: await container.auth.listRoles() });
    })
  );

  // ----------------------------------------------------------------- audit
  router.get(
    "/audit-logs",
    requirePermission("AUDIT_READ"),
    asyncHandler(async (req, res) => {
      res.json(
        await container.audit.list({
          resource: req.query.resource as string | undefined,
          resourceId: req.query.resourceId as string | undefined,
          userId: req.query.userId as string | undefined,
          action: req.query.action as string | undefined,
          take: num(req.query.take, 50),
          skip: num(req.query.skip, 0),
        })
      );
    })
  );

  router.use((req, _res, next) => {
    next(new DomainError("NOT_FOUND", `No route for ${req.method} ${req.path}`, 404));
  });

  return router;
}
