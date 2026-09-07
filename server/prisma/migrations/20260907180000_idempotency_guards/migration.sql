-- Idempotency guards.
--
-- Every statement here is additive: new nullable columns, new columns with
-- constant defaults, and new indexes. No table is dropped or rebuilt, so
-- existing rows keep their identity and the migration is safe to apply to a
-- live database.
--
-- Renewal and Extension previously had no dedup at all: the routes demanded an
-- Idempotency-Key header and the service ignored it, so a retried request wrote
-- a second renewal and a second loan carrying the same balance forward. The
-- unique indexes below are the real guard; the service supplies the key.
-- Nullable, because rows written before this migration have no key and must
-- stay valid — and because SQLite's unique indexes treat NULLs as distinct,
-- so any number of historical rows coexist.

-- AlterTable
ALTER TABLE "Renewal" ADD COLUMN "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "Extension" ADD COLUMN "idempotencyKey" TEXT;

-- AlterTable: fingerprint lets the same key with a different body be refused
-- rather than silently replayed; statusCode replays the original outcome.
ALTER TABLE "IdempotencyRecord" ADD COLUMN "fingerprint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "IdempotencyRecord" ADD COLUMN "statusCode" INTEGER NOT NULL DEFAULT 200;

-- CreateIndex
CREATE UNIQUE INDEX "Renewal_idempotencyKey_key" ON "Renewal"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Extension_idempotencyKey_key" ON "Extension"("idempotencyKey");
