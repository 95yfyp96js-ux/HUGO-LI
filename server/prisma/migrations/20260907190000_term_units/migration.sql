-- Term units: a product's term may now be counted in days or in months.
--
-- Non-destructive throughout. The four term columns are RENAMED in place
-- (SQLite 3.25+ ALTER TABLE ... RENAME COLUMN), which preserves every row and
-- rebuilds no table, and termUnit is added with a constant default. Existing
-- rows are all month-based, and 'MONTH' is exactly what the default gives
-- them, so no backfill is needed and no existing loan changes meaning.
--
-- The columns were named "...TermMonths" while holding a count of periods.
-- Now that the period can be a day, that name would state the wrong unit on
-- every short-term loan, so the unit moves into its own column and the count
-- is named for what it is.

-- LoanProduct
ALTER TABLE "LoanProduct" RENAME COLUMN "minTermMonths" TO "minTermCount";
ALTER TABLE "LoanProduct" RENAME COLUMN "maxTermMonths" TO "maxTermCount";
ALTER TABLE "LoanProduct" ADD COLUMN "termUnit" TEXT NOT NULL DEFAULT 'MONTH';

-- LendingApplication
ALTER TABLE "LendingApplication" RENAME COLUMN "requestedTermMonths" TO "requestedTermCount";

-- LoanOffer
ALTER TABLE "LoanOffer" RENAME COLUMN "termMonths" TO "termCount";
ALTER TABLE "LoanOffer" ADD COLUMN "termUnit" TEXT NOT NULL DEFAULT 'MONTH';

-- LoanApproval
ALTER TABLE "LoanApproval" RENAME COLUMN "approvedTermMonths" TO "approvedTermCount";

-- LoanSnapshot: the frozen contract. Existing snapshots keep their term
-- exactly as agreed and are simply labelled with the unit they always meant.
ALTER TABLE "LoanSnapshot" RENAME COLUMN "termMonths" TO "termCount";
ALTER TABLE "LoanSnapshot" ADD COLUMN "termUnit" TEXT NOT NULL DEFAULT 'MONTH';
