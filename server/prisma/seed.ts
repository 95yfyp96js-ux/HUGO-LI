/**
 * Seed data for Small Lending OS v1.0.
 *
 * Everything here is created THROUGH the real services and engines, not by
 * inserting rows directly. That guarantees the fixture data obeys every
 * domain invariant: no loan without an approved application, no payment
 * without an allocation and ledger event, no balance that the BalanceEngine
 * cannot reproduce.
 *
 * A MockClock is wound forward through history so loans genuinely age into
 * DUE / OVERDUE states rather than being stamped with fake statuses.
 */
import { PrismaClient } from "@prisma/client";
import { createContainer } from "../src/container.js";
import { MockClock } from "../src/shared/clock.js";
import { hashPassword } from "../src/modules/auth/infrastructure/password.js";
import { ROLE_PERMISSIONS, PERMISSIONS, type RoleCode } from "../src/modules/auth/domain/permissions.js";
import { Money } from "../src/shared/money.js";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

const SEED_START = new Date("2026-01-05T09:00:00Z");
const TODAY = new Date("2026-09-07T09:00:00Z");

const FIRST_NAMES = ["建宏", "怡君", "志明", "淑芬", "家豪", "美玲", "俊傑", "雅婷", "承翰", "宜蓁"];
const SURNAMES = ["林", "陳", "黃", "張", "李", "王", "吳", "劉", "蔡", "楊"];
const EMPLOYERS = ["宏達電子", "台北物流", "永安建設", "自營商店", "中華餐飲", "新光紡織"];
const PURPOSES = ["營運週轉", "醫療支出", "教育費用", "房屋修繕", "債務整合", "設備採購"];

/** Deterministic PRNG so every seed run produces the same portfolio. */
let seedState = 42;
function random(): number {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
function pick<T>(items: T[]): T {
  return items[Math.floor(random() * items.length)]!;
}
function randomInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

async function reset() {
  // Order matters: children before parents.
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.promiseToPay.deleteMany(),
    prisma.collectionActivity.deleteMany(),
    prisma.collectionCase.deleteMany(),
    prisma.settlement.deleteMany(),
    prisma.extension.deleteMany(),
    prisma.renewal.deleteMany(),
    prisma.paymentAllocation.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.moneyEvent.deleteMany(),
    prisma.interestAccrual.deleteMany(),
    prisma.scheduleLine.deleteMany(),
    prisma.disbursement.deleteMany(),
    prisma.loanAdjustment.deleteMany(),
    prisma.loanSnapshot.deleteMany(),
    prisma.loan.deleteMany(),
    prisma.loanApproval.deleteMany(),
    prisma.loanOffer.deleteMany(),
    prisma.lendingLimit.deleteMany(),
    prisma.riskFactor.deleteMany(),
    prisma.riskAssessment.deleteMany(),
    prisma.lendingApplication.deleteMany(),
    prisma.loanProduct.deleteMany(),
    prisma.customerNote.deleteMany(),
    prisma.document.deleteMany(),
    prisma.idempotencyRecord.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.userRole.deleteMany(),
    prisma.rolePermission.deleteMany(),
    prisma.permission.deleteMany(),
    prisma.role.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

async function seedRbac() {
  for (const code of PERMISSIONS) {
    await prisma.permission.create({ data: { code } });
  }

  const roleNames: Record<RoleCode, string> = {
    ADMIN: "系統管理員",
    MANAGER: "放款主管",
    LOAN_OFFICER: "放款專員",
    COLLECTOR: "催收專員",
    AUDITOR: "稽核人員",
  };

  for (const [code, permissions] of Object.entries(ROLE_PERMISSIONS) as [RoleCode, string[]][]) {
    const role = await prisma.role.create({ data: { code, name: roleNames[code] } });
    for (const permissionCode of permissions) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: permissionCode } });
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  // Demo credentials. Development-only passwords, and the hash is scrypt —
  // there are no plaintext credentials stored anywhere.
  const users: Array<{ email: string; displayName: string; role: RoleCode }> = [
    { email: "admin@lending.local", displayName: "系統管理員", role: "ADMIN" },
    { email: "manager@lending.local", displayName: "王經理", role: "MANAGER" },
    { email: "officer@lending.local", displayName: "陳專員", role: "LOAN_OFFICER" },
    { email: "collector@lending.local", displayName: "林催收", role: "COLLECTOR" },
    { email: "auditor@lending.local", displayName: "黃稽核", role: "AUDITOR" },
  ];

  const created: Record<string, string> = {};
  for (const user of users) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: user.role } });
    const record = await prisma.user.create({
      data: {
        email: user.email,
        displayName: user.displayName,
        passwordHash: hashPassword(process.env.SEED_PASSWORD ?? "Password123!"),
        roles: { create: { roleId: role.id } },
      },
    });
    created[user.role] = record.id;
  }
  return created;
}

async function seedProducts() {
  const products = [
    {
      productCode: "SL-STD",
      name: "標準小額信貸",
      description: "一般客戶適用，按月付息、到期還本",
      minAmountCents: Money.fromMajorUnits(10000).toMinorUnits(),
      maxAmountCents: Money.fromMajorUnits(500000).toMinorUnits(),
      minTermCount: 1,
      maxTermCount: 12,
      ratePercent: 2.5,
      rateUnit: "MONTHLY",
      calculationMethod: "SIMPLE_INTEREST",
      repaymentMethod: "INTEREST_ONLY",
      feeRules: JSON.stringify([
        { code: "ORIGINATION", label: "開辦費", type: "PERCENT_OF_PRINCIPAL", value: 1 },
      ]),
    },
    {
      productCode: "SL-AMORT",
      name: "分期攤還信貸",
      description: "本息平均攤還，適合固定收入客戶",
      minAmountCents: Money.fromMajorUnits(20000).toMinorUnits(),
      maxAmountCents: Money.fromMajorUnits(300000).toMinorUnits(),
      minTermCount: 3,
      maxTermCount: 24,
      ratePercent: 2.0,
      rateUnit: "MONTHLY",
      calculationMethod: "SIMPLE_INTEREST",
      repaymentMethod: "PRINCIPAL_AND_INTEREST",
      feeRules: JSON.stringify([{ code: "ADMIN", label: "帳戶管理費", type: "FLAT", value: 500 }]),
    },
    {
      productCode: "SL-SHORT",
      name: "短期週轉金",
      description: "一次到期清償，適合短期資金缺口",
      minAmountCents: Money.fromMajorUnits(5000).toMinorUnits(),
      maxAmountCents: Money.fromMajorUnits(150000).toMinorUnits(),
      minTermCount: 1,
      maxTermCount: 3,
      ratePercent: 3.0,
      rateUnit: "MONTHLY",
      calculationMethod: "SIMPLE_INTEREST",
      repaymentMethod: "BULLET",
      feeRules: "[]",
    },
    {
      // The only day-term product: its term is counted in days and its rate is
      // quoted per day, so 7 days at 0.1% costs 0.7% of principal in total.
      productCode: "SL-DAILY",
      name: "短天期單利",
      description: "以日計息、一次到期清償，7 至 30 天的短期練習用商品",
      minAmountCents: Money.fromMajorUnits(10000).toMinorUnits(),
      maxAmountCents: Money.fromMajorUnits(200000).toMinorUnits(),
      minTermCount: 7,
      maxTermCount: 30,
      termUnit: "DAY",
      ratePercent: 0.1,
      rateUnit: "DAILY",
      calculationMethod: "SIMPLE_INTEREST",
      repaymentMethod: "BULLET",
      feeRules: "[]",
    },
  ];

  const created = [];
  for (const product of products) {
    created.push(await prisma.loanProduct.create({ data: product }));
  }
  return created;
}

async function main() {
  console.log("Resetting database...");
  await reset();

  console.log("Seeding roles, permissions and users...");
  const userIds = await seedRbac();

  console.log("Seeding loan products...");
  const products = await seedProducts();

  const clock = new MockClock(SEED_START);
  const container = createContainer({ db: prisma, clock });

  const adminContext = { userId: userIds.ADMIN!, ip: "127.0.0.1" };
  const officerContext = { userId: userIds.LOAN_OFFICER!, ip: "127.0.0.1" };
  const managerContext = { userId: userIds.MANAGER!, ip: "127.0.0.1" };
  const collectorContext = { userId: userIds.COLLECTOR!, ip: "127.0.0.1" };

  console.log("Seeding customers...");
  const customers = [];
  for (let i = 0; i < 30; i++) {
    clock.set(new Date(SEED_START.getTime() + i * 6 * 60 * 60 * 1000));
    const name = `${pick(SURNAMES)}${pick(FIRST_NAMES)}`;
    const income = randomInt(28, 120) * 1000;
    customers.push(
      await container.customers.create(
        {
          name,
          identityNumber: `A${randomInt(1, 2)}${String(randomInt(10000000, 99999999))}`,
          dateOfBirth: new Date(
            randomInt(1970, 2000),
            randomInt(0, 11),
            randomInt(1, 28)
          ).toISOString(),
          phone: `09${String(randomInt(10000000, 99999999))}`,
          email: `customer${i + 1}@example.com`,
          address: `台北市信義區信義路${randomInt(1, 5)}段${randomInt(1, 200)}號`,
          employmentStatus: random() > 0.2 ? "EMPLOYED" : "SELF_EMPLOYED",
          employer: pick(EMPLOYERS),
          monthlyIncome: income,
        },
        officerContext
      )
    );
  }

  console.log("Seeding applications, loans, disbursements and payments...");
  let loanCount = 0;
  let paymentCount = 0;
  let applicationCount = 0;

  // Build 50 applications; most convert to loans at staggered dates so the
  // portfolio contains a realistic spread of ages and states.
  for (let i = 0; i < 72; i++) {
    const customer = customers[i % customers.length]!;
    const product = products[i % products.length]!;

    // Applications are opened progressively across the last eight months.
    const openedAt = new Date(SEED_START.getTime() + i * 3.2 * 24 * 60 * 60 * 1000);
    if (openedAt > TODAY) break;
    clock.set(openedAt);

    const amount = randomInt(2, 20) * 10000;
    // Cap only month terms at 6; a day-term product's own range is the limit.
    const term =
      product.termUnit === "DAY"
        ? randomInt(product.minTermCount, product.maxTermCount)
        : randomInt(product.minTermCount, Math.min(product.maxTermCount, 6));

    const application = await container.applications.create(
      {
        customerId: customer.id,
        requestedProductId: product.id,
        // Clamped into the product's published range, which applications are
        // now validated against.
        requestedAmount: Math.min(
          Math.max(amount, Money.fromMinorUnits(product.minAmountCents).toMajorUnitsNumber()),
          Money.fromMinorUnits(product.maxAmountCents).toMajorUnitsNumber()
        ),
        requestedTermCount: term,
        purpose: pick(PURPOSES),
        income: customer.monthlyIncomeCents
          ? Money.fromMinorUnits(customer.monthlyIncomeCents).toMajorUnitsNumber()
          : null,
        existingDebt: random() > 0.5 ? randomInt(0, 8) * 10000 : 0,
      },
      officerContext
    );
    applicationCount++;

    // A slice stays in draft to populate the pipeline view.
    if (i % 12 === 11) continue;

    const submitted = await container.applications.submit(application.id, officerContext);

    // Anything the engines flagged for review, or that priced no viable
    // offer, is genuinely declined rather than force-approved.
    if (!submitted.offer || submitted.limit.recommendedAmountCents <= 0) {
      await container.approvals.reject(
        application.id,
        "額度不足或風險過高，婉拒本次申請",
        managerContext
      );
      continue;
    }
    if (submitted.application.status === "RISK_REVIEW") {
      if (i % 4 === 0) {
        await container.approvals.reject(application.id, "風險評估未通過", managerContext);
        continue;
      }
      if (i % 4 === 1) {
        // A reviewer overrides the referral and approves on conditions.
        await container.approvals.approve(
          application.id,
          {
            reason: "經人工複核，客戶提供擔保後同意承作",
            conditions: [{ code: "GUARANTOR", description: "須提供保證人" }],
          },
          managerContext
        );
      } else {
        // Leave the rest sitting in the approval queue for the reviewer UI.
        continue;
      }
    } else {
      await container.approvals.approve(application.id, { reason: "符合授信條件" }, managerContext);
    }

    // A few approved applications wait for disbursement.
    if (i % 14 === 13) {
      await container.loans.createFromApprovedApplication(application.id, managerContext);
      continue;
    }

    const loan = await container.loans.createFromApprovedApplication(application.id, managerContext);
    await container.loans.disburse(
      loan.id,
      { method: "BANK_TRANSFER", idempotencyKey: `seed-disburse-${loan.id}` },
      managerContext
    );
    loanCount++;

    // Repayment behaviour: most pay on time, some fall behind, some clear early.
    const behaviour = random();
    const schedule = await prisma.scheduleLine.findMany({
      where: { loanId: loan.id },
      orderBy: { installmentNumber: "asc" },
    });

    for (const line of schedule) {
      if (line.dueDate > TODAY) break;

      // Delinquent borrowers stop paying partway through.
      if (behaviour > 0.78 && line.installmentNumber > 1) break;

      const payDate = new Date(line.dueDate.getTime());
      if (behaviour > 0.6) payDate.setDate(payDate.getDate() + randomInt(1, 9));
      if (payDate > TODAY) break;

      clock.set(payDate);
      const outstanding = await container.payments.getOutstanding(loan.id);
      const total = outstanding.principal.add(outstanding.interest).add(outstanding.fees);
      if (!total.isPositive()) break;

      const due = Money.fromMinorUnits(
        line.totalDueCents - (line.principalPaidCents + line.interestPaidCents + line.feePaidCents)
      );
      const amountToPay = Money.min(due.isPositive() ? due : total, total);
      if (!amountToPay.isPositive()) break;

      await container.payments.create(
        {
          loanId: loan.id,
          amount: amountToPay.toMajorUnitsString(),
          method: pick(["CASH", "BANK_TRANSFER", "ATM"]),
          idempotencyKey: `seed-payment-${loan.id}-${line.installmentNumber}`,
        },
        officerContext
      );
      paymentCount++;
    }
  }

  // Bring every loan's delinquency state up to "today".
  console.log("Ageing portfolio to current date...");
  clock.set(TODAY);
  const liveLoans = await prisma.loan.findMany({
    where: { status: { in: ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"] } },
  });
  for (const loan of liveLoans) {
    await container.loans.refreshDelinquency(loan.id, adminContext);
  }

  console.log("Opening collection cases for overdue loans...");
  const { openedCaseIds } = await container.collections.syncCasesForOverdueLoans(collectorContext);

  // Give collectors a realistic activity trail to work from.
  for (const caseId of openedCaseIds.slice(0, 10)) {
    await container.collections.addActivity(
      caseId,
      {
        type: pick(["PHONE", "SMS", "IN_PERSON"]) as "PHONE" | "SMS" | "IN_PERSON",
        result: pick(["客戶未接", "客戶承諾還款", "已寄發催繳簡訊"]),
        note: "系統建檔後首次聯繫",
        nextActionAt: new Date(TODAY.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      collectorContext
    );
  }
  for (const caseId of openedCaseIds.slice(0, 4)) {
    const collectionCase = await prisma.collectionCase.findUniqueOrThrow({ where: { id: caseId } });
    await container.collections.addPromiseToPay(
      caseId,
      {
        amount: Money.fromMinorUnits(Math.floor(collectionCase.outstandingAmountCents / 2))
          .toMajorUnitsString(),
        promisedDate: new Date(TODAY.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      collectorContext
    );
  }

  console.log("Creating renewals...");
  const renewable = await prisma.loan.findMany({
    where: { status: { in: ["ACTIVE", "DUE_SOON", "DUE"] } },
    take: 10,
    orderBy: { createdAt: "asc" },
  });
  for (const loan of renewable) {
    await container.renewals.renew(
      loan.id,
      { reason: "客戶申請續借，延長還款期間", termCount: 3, idempotencyKey: `seed-renew-${loan.id}` },
      managerContext
    );
  }

  console.log("Creating extensions...");
  const extendable = await prisma.loan.findMany({
    where: { status: { in: ["OVERDUE", "DUE"] } },
    take: 4,
  });
  for (const loan of extendable) {
    await container.renewals.extend(
      loan.id,
      {
        idempotencyKey: randomUUID(),
        extensionMonths: 1,
        fee: 500,
        reason: "客戶短期資金困難，同意展延一個月",
      },
      managerContext
    );
  }

  const [customerTotal, applicationTotal, loanTotal, paymentTotal, caseTotal, auditTotal, renewalTotal] =
    await Promise.all([
      prisma.customer.count(),
      prisma.lendingApplication.count(),
      prisma.loan.count(),
      prisma.payment.count(),
      prisma.collectionCase.count(),
      prisma.auditLog.count(),
      prisma.renewal.count(),
    ]);

  console.log("\nSeed complete:");
  console.table({
    customers: customerTotal,
    applications: applicationTotal,
    loans: loanTotal,
    payments: paymentTotal,
    collectionCases: caseTotal,
    renewals: renewalTotal,
    auditLogs: auditTotal,
  });
  void applicationCount;
  void loanCount;
  void paymentCount;
  console.log("\nLogin with admin@lending.local / Password123! (development only)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
