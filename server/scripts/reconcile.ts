/**
 * Data integrity check (spec §24).
 *
 * Replays every loan's MoneyEvent ledger through the BalanceEngine and
 * compares the result to the stored balance columns. Stored balances are a
 * projection; if this script ever reports a mismatch, the projection has
 * drifted from the source of truth and the loan needs investigating.
 *
 * Run with: npm run reconcile --workspace server
 */
import { PrismaClient } from "@prisma/client";
import { createContainer } from "../src/container.js";

async function main() {
  const prisma = new PrismaClient();
  const container = createContainer({ db: prisma });

  const loans = await prisma.loan.findMany();
  let mismatches = 0;

  for (const loan of loans) {
    const projected = await container.loans.recalculateLoanBalance(loan.id);
    const principal = projected.outstandingPrincipal.toMinorUnits();
    const interest = projected.outstandingInterest.toMinorUnits();
    const fees = projected.outstandingFees.toMinorUnits();

    if (
      principal !== loan.outstandingPrincipalCents ||
      interest !== loan.outstandingInterestCents ||
      fees !== loan.outstandingFeeCents
    ) {
      mismatches++;
      console.log(`MISMATCH ${loan.loanNumber} (${loan.status})`);
      console.log(
        `  stored:    principal=${loan.outstandingPrincipalCents} interest=${loan.outstandingInterestCents} fees=${loan.outstandingFeeCents}`
      );
      console.log(`  projected: principal=${principal} interest=${interest} fees=${fees}`);
    }
  }

  // Invariant §74.7: an allocation must account for the whole payment.
  const badAllocations = await prisma.$queryRawUnsafe<Array<{ bad: number }>>(`
    SELECT COUNT(*) as bad FROM Payment p
    JOIN PaymentAllocation a ON a.paymentId = p.id
    WHERE p.amountCents != (a.principalAmountCents + a.interestAmountCents + a.feeAmountCents)
  `);

  // Invariant §74.6: every payment points at a real loan.
  const orphanPayments = await prisma.$queryRawUnsafe<Array<{ bad: number }>>(`
    SELECT COUNT(*) as bad FROM Payment p
    LEFT JOIN Loan l ON l.id = p.loanId
    WHERE l.id IS NULL
  `);

  // Every loan must have a snapshot once it exists.
  const loansWithoutSnapshot = await prisma.$queryRawUnsafe<Array<{ bad: number }>>(`
    SELECT COUNT(*) as bad FROM Loan l
    LEFT JOIN LoanSnapshot s ON s.loanId = l.id
    WHERE s.id IS NULL
  `);

  console.log("\n─────────────────────────────────────────");
  console.log(`Loans checked:                    ${loans.length}`);
  console.log(`Balance mismatches:               ${mismatches}`);
  console.log(`Payments not matching allocation: ${badAllocations[0]?.bad ?? 0}`);
  console.log(`Orphan payments:                  ${orphanPayments[0]?.bad ?? 0}`);
  console.log(`Loans missing a snapshot:         ${loansWithoutSnapshot[0]?.bad ?? 0}`);
  console.log("─────────────────────────────────────────");

  await prisma.$disconnect();

  const failed =
    mismatches > 0 ||
    (badAllocations[0]?.bad ?? 0) > 0 ||
    (orphanPayments[0]?.bad ?? 0) > 0 ||
    (loansWithoutSnapshot[0]?.bad ?? 0) > 0;

  if (failed) {
    console.error("\nFAILED: the ledger and the stored balances disagree.");
    process.exit(1);
  }
  console.log("\nOK: every stored balance is reproducible from the ledger.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
