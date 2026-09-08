-- Shop settings (singleton rate cap) and daily close.
--
-- Additive only: two new tables, two indexes. Nothing existing is touched.
-- ShopSettings.id defaults to 'default' so the row is a natural singleton
-- with no separate "is this the active config" flag needed. DailyClose has
-- no row for an open day — only closed (or once-closed, now reopened) days
-- get one, so most days need no row at all.

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "maxMonthlyRatePercent" REAL,
    "updatedAt" DATETIME NOT NULL,
    "updatedBy" TEXT
);

-- CreateTable
CREATE TABLE "DailyClose" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLOSED',
    "closedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedBy" TEXT,
    "reopenedAt" DATETIME,
    "reopenedBy" TEXT,
    "reopenReason" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyClose_date_key" ON "DailyClose"("date");

-- CreateIndex
CREATE INDEX "DailyClose_date_idx" ON "DailyClose"("date");

