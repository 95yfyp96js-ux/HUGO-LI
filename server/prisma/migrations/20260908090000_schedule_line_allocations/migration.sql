-- One row per (payment, installment) touched by that payment's allocation.
--
-- Additive only: one new table, two indexes, no existing table touched.
-- Needed to answer the daily-close question precisely: how much of a given
-- day's collected money was actually applied against installments due that
-- same day, versus an older or later one. ScheduleLine's own paidCents
-- columns are only running totals and cannot answer that on their own.

-- CreateTable
CREATE TABLE "ScheduleLineAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "scheduleLineId" TEXT NOT NULL,
    "principalAmountCents" INTEGER NOT NULL,
    "interestAmountCents" INTEGER NOT NULL,
    "feeAmountCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduleLineAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduleLineAllocation_scheduleLineId_fkey" FOREIGN KEY ("scheduleLineId") REFERENCES "ScheduleLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ScheduleLineAllocation_scheduleLineId_idx" ON "ScheduleLineAllocation"("scheduleLineId");

-- CreateIndex
CREATE INDEX "ScheduleLineAllocation_paymentId_idx" ON "ScheduleLineAllocation"("paymentId");

