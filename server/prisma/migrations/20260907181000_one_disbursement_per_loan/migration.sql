-- At most one COMPLETED disbursement per loan (invariant §74.5).
--
-- Additive: one nullable column and one unique index. NULLs are distinct in
-- both SQLite and PostgreSQL unique indexes, so any number of FAILED or
-- PENDING attempts coexist while the second COMPLETED one for a loan is
-- refused by the database.
--
-- Backfill sets the column for disbursements that are already COMPLETED, so
-- existing data starts out consistent with the constraint. If a database
-- already contains two completed disbursements for one loan, this index will
-- fail to create — which is the correct outcome: that is corrupt data and it
-- must be reconciled by hand, not indexed over.

-- AlterTable
ALTER TABLE "Disbursement" ADD COLUMN "completedForLoanId" TEXT;

-- Backfill existing completed disbursements.
UPDATE "Disbursement" SET "completedForLoanId" = "loanId" WHERE "status" = 'COMPLETED';

-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_completedForLoanId_key" ON "Disbursement"("completedForLoanId");
