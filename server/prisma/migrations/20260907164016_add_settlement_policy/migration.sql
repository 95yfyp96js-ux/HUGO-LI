-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LoanOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "approvedAmountCents" INTEGER NOT NULL,
    "ratePercent" REAL NOT NULL,
    "rateUnit" TEXT NOT NULL,
    "calculationMethod" TEXT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "feesCents" INTEGER NOT NULL,
    "repaymentMethod" TEXT NOT NULL,
    "settlementPolicy" TEXT NOT NULL DEFAULT 'FULL_CONTRACT_INTEREST',
    "totalInterestCents" INTEGER NOT NULL,
    "totalPayableCents" INTEGER NOT NULL,
    "pricingVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoanOffer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LendingApplication" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LoanOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "LoanProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LoanOffer" ("applicationId", "approvedAmountCents", "calculationMethod", "createdAt", "feesCents", "id", "pricingVersion", "productId", "ratePercent", "rateUnit", "repaymentMethod", "termMonths", "totalInterestCents", "totalPayableCents") SELECT "applicationId", "approvedAmountCents", "calculationMethod", "createdAt", "feesCents", "id", "pricingVersion", "productId", "ratePercent", "rateUnit", "repaymentMethod", "termMonths", "totalInterestCents", "totalPayableCents" FROM "LoanOffer";
DROP TABLE "LoanOffer";
ALTER TABLE "new_LoanOffer" RENAME TO "LoanOffer";
CREATE TABLE "new_LoanProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "minAmountCents" INTEGER NOT NULL,
    "maxAmountCents" INTEGER NOT NULL,
    "minTermMonths" INTEGER NOT NULL,
    "maxTermMonths" INTEGER NOT NULL,
    "ratePercent" REAL NOT NULL,
    "rateUnit" TEXT NOT NULL,
    "calculationMethod" TEXT NOT NULL,
    "repaymentMethod" TEXT NOT NULL,
    "settlementPolicy" TEXT NOT NULL DEFAULT 'FULL_CONTRACT_INTEREST',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "feeRules" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_LoanProduct" ("calculationMethod", "createdAt", "description", "feeRules", "id", "maxAmountCents", "maxTermMonths", "minAmountCents", "minTermMonths", "name", "productCode", "ratePercent", "rateUnit", "repaymentMethod", "status", "updatedAt", "version") SELECT "calculationMethod", "createdAt", "description", "feeRules", "id", "maxAmountCents", "maxTermMonths", "minAmountCents", "minTermMonths", "name", "productCode", "ratePercent", "rateUnit", "repaymentMethod", "status", "updatedAt", "version" FROM "LoanProduct";
DROP TABLE "LoanProduct";
ALTER TABLE "new_LoanProduct" RENAME TO "LoanProduct";
CREATE UNIQUE INDEX "LoanProduct_productCode_version_key" ON "LoanProduct"("productCode", "version");
CREATE TABLE "new_LoanSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loanId" TEXT NOT NULL,
    "principalCents" INTEGER NOT NULL,
    "ratePercent" REAL NOT NULL,
    "rateUnit" TEXT NOT NULL,
    "calculationMethod" TEXT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "repaymentMethod" TEXT NOT NULL,
    "settlementPolicy" TEXT NOT NULL DEFAULT 'FULL_CONTRACT_INTEREST',
    "productId" TEXT NOT NULL,
    "productVersion" INTEGER NOT NULL,
    "feeRules" TEXT NOT NULL,
    "pricingVersion" TEXT NOT NULL,
    "riskAssessmentVersion" TEXT NOT NULL,
    "approvalVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoanSnapshot_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LoanSnapshot" ("approvalVersion", "calculationMethod", "createdAt", "feeRules", "id", "loanId", "pricingVersion", "principalCents", "productId", "productVersion", "ratePercent", "rateUnit", "repaymentMethod", "riskAssessmentVersion", "termMonths") SELECT "approvalVersion", "calculationMethod", "createdAt", "feeRules", "id", "loanId", "pricingVersion", "principalCents", "productId", "productVersion", "ratePercent", "rateUnit", "repaymentMethod", "riskAssessmentVersion", "termMonths" FROM "LoanSnapshot";
DROP TABLE "LoanSnapshot";
ALTER TABLE "new_LoanSnapshot" RENAME TO "LoanSnapshot";
CREATE UNIQUE INDEX "LoanSnapshot_loanId_key" ON "LoanSnapshot"("loanId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
