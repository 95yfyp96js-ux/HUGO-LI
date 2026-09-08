-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LendingApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "requestedProductId" TEXT,
    "requestedAmountCents" INTEGER NOT NULL,
    "requestedTermCount" INTEGER NOT NULL,
    "purpose" TEXT,
    "incomeCents" INTEGER,
    "existingDebtCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "slipIdempotencyKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LendingApplication_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LendingApplication_requestedProductId_fkey" FOREIGN KEY ("requestedProductId") REFERENCES "LoanProduct" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LendingApplication" ("applicationNumber", "createdAt", "customerId", "existingDebtCents", "id", "incomeCents", "purpose", "requestedAmountCents", "requestedProductId", "requestedTermCount", "status", "updatedAt") SELECT "applicationNumber", "createdAt", "customerId", "existingDebtCents", "id", "incomeCents", "purpose", "requestedAmountCents", "requestedProductId", "requestedTermCount", "status", "updatedAt" FROM "LendingApplication";
DROP TABLE "LendingApplication";
ALTER TABLE "new_LendingApplication" RENAME TO "LendingApplication";
CREATE UNIQUE INDEX "LendingApplication_applicationNumber_key" ON "LendingApplication"("applicationNumber");
CREATE UNIQUE INDEX "LendingApplication_slipIdempotencyKey_key" ON "LendingApplication"("slipIdempotencyKey");
CREATE INDEX "LendingApplication_status_idx" ON "LendingApplication"("status");
CREATE INDEX "LendingApplication_customerId_idx" ON "LendingApplication"("customerId");
CREATE TABLE "new_Loan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loanNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "productId" TEXT,
    "principalCents" INTEGER NOT NULL,
    "outstandingPrincipalCents" INTEGER NOT NULL,
    "outstandingInterestCents" INTEGER NOT NULL,
    "outstandingFeeCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "startDate" DATETIME,
    "maturityDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Loan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Loan_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LendingApplication" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Loan" ("applicationId", "createdAt", "customerId", "id", "loanNumber", "maturityDate", "outstandingFeeCents", "outstandingInterestCents", "outstandingPrincipalCents", "principalCents", "productId", "startDate", "status", "updatedAt") SELECT "applicationId", "createdAt", "customerId", "id", "loanNumber", "maturityDate", "outstandingFeeCents", "outstandingInterestCents", "outstandingPrincipalCents", "principalCents", "productId", "startDate", "status", "updatedAt" FROM "Loan";
DROP TABLE "Loan";
ALTER TABLE "new_Loan" RENAME TO "Loan";
CREATE UNIQUE INDEX "Loan_loanNumber_key" ON "Loan"("loanNumber");
CREATE UNIQUE INDEX "Loan_applicationId_key" ON "Loan"("applicationId");
CREATE INDEX "Loan_status_idx" ON "Loan"("status");
CREATE INDEX "Loan_customerId_idx" ON "Loan"("customerId");
CREATE TABLE "new_LoanSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loanId" TEXT NOT NULL,
    "principalCents" INTEGER NOT NULL,
    "ratePercent" REAL NOT NULL,
    "rateUnit" TEXT NOT NULL,
    "calculationMethod" TEXT NOT NULL,
    "termCount" INTEGER NOT NULL,
    "termUnit" TEXT NOT NULL DEFAULT 'MONTH',
    "repaymentMethod" TEXT NOT NULL,
    "settlementPolicy" TEXT NOT NULL DEFAULT 'FULL_CONTRACT_INTEREST',
    "productId" TEXT,
    "productVersion" INTEGER,
    "feeRules" TEXT NOT NULL,
    "pricingVersion" TEXT NOT NULL,
    "riskAssessmentVersion" TEXT NOT NULL,
    "approvalVersion" TEXT NOT NULL,
    "overdueRatePercent" REAL,
    "interestTiming" TEXT NOT NULL DEFAULT 'POST_PAID',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoanSnapshot_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LoanSnapshot" ("approvalVersion", "calculationMethod", "createdAt", "feeRules", "id", "loanId", "pricingVersion", "principalCents", "productId", "productVersion", "ratePercent", "rateUnit", "repaymentMethod", "riskAssessmentVersion", "settlementPolicy", "termCount", "termUnit") SELECT "approvalVersion", "calculationMethod", "createdAt", "feeRules", "id", "loanId", "pricingVersion", "principalCents", "productId", "productVersion", "ratePercent", "rateUnit", "repaymentMethod", "riskAssessmentVersion", "settlementPolicy", "termCount", "termUnit" FROM "LoanSnapshot";
DROP TABLE "LoanSnapshot";
ALTER TABLE "new_LoanSnapshot" RENAME TO "LoanSnapshot";
CREATE UNIQUE INDEX "LoanSnapshot_loanId_key" ON "LoanSnapshot"("loanId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
