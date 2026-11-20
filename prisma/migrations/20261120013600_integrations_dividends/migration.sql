-- CreateEnum
CREATE TYPE "dividend_kind" AS ENUM ('OFFICIAL', 'FORECAST');

-- CreateEnum
CREATE TYPE "dividend_type" AS ENUM ('INCOME', 'AMORTIZATION');

-- CreateEnum
CREATE TYPE "data_source" AS ENUM ('MANUAL', 'BRAPI', 'B3_FUNDOSNET');

-- CreateEnum
CREATE TYPE "eligibility_source" AS ENUM ('LEDGER', 'MANUAL');

-- CreateEnum
CREATE TYPE "sync_kind" AS ENUM ('QUOTES', 'DIVIDENDS', 'ASSET_INFO', 'PRICE_HISTORY');

-- CreateEnum
CREATE TYPE "sync_status" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "quote_source" ADD VALUE 'BRAPI';
ALTER TYPE "quote_source" ADD VALUE 'BRAPI_DAILY_CLOSE';

-- AlterTable
ALTER TABLE "funds" ADD COLUMN     "cnpj" TEXT;

-- AlterTable
ALTER TABLE "price_quotes" ADD COLUMN     "change" DECIMAL(18,8),
ADD COLUMN     "change_percent" DECIMAL(12,6),
ADD COLUMN     "market_time" TIMESTAMPTZ(3),
ADD COLUMN     "previous_close" DECIMAL(18,8);

-- CreateTable
CREATE TABLE "daily_prices" (
    "id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "open" DECIMAL(18,8),
    "high" DECIMAL(18,8),
    "low" DECIMAL(18,8),
    "close" DECIMAL(18,8) NOT NULL,
    "adjusted_close" DECIMAL(18,8),
    "volume" DECIMAL(24,0),
    "source" "quote_source" NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dividend_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "kind" "dividend_kind" NOT NULL,
    "type" "dividend_type" NOT NULL,
    "source" "data_source" NOT NULL,
    "rate_per_share" DECIMAL(18,8) NOT NULL,
    "data_com" DATE NOT NULL,
    "payment_date" DATE,
    "approved_on" DATE,
    "competence" TEXT,
    "reference_label" TEXT,
    "verified" BOOLEAN,
    "external_id" TEXT,
    "notes" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dividend_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dividend_receipts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "eligible_quantity" DECIMAL(18,8) NOT NULL,
    "quantity_source" "eligibility_source" NOT NULL,
    "rate_per_share" DECIMAL(18,8) NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "payment_date" DATE NOT NULL,
    "notes" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dividend_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "sync_kind" NOT NULL,
    "provider" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "sync_status" NOT NULL,
    "message" TEXT,
    "items_ok" INTEGER NOT NULL DEFAULT 0,
    "items_failed" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" TEXT NOT NULL,
    "auto_update_enabled" BOOLEAN NOT NULL DEFAULT true,
    "quote_refresh_minutes" INTEGER NOT NULL DEFAULT 30,
    "dividend_refresh_hours" INTEGER NOT NULL DEFAULT 12,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_prices_fund_id_date_source_key" ON "daily_prices"("fund_id", "date", "source");

-- CreateIndex
CREATE INDEX "dividend_events_user_id_payment_date_idx" ON "dividend_events"("user_id", "payment_date");

-- CreateIndex
CREATE INDEX "dividend_events_fund_id_data_com_idx" ON "dividend_events"("fund_id", "data_com");

-- CreateIndex
CREATE INDEX "dividend_receipts_user_id_payment_date_idx" ON "dividend_receipts"("user_id", "payment_date");

-- CreateIndex
CREATE INDEX "sync_runs_user_id_kind_started_at_idx" ON "sync_runs"("user_id", "kind", "started_at");

-- AddForeignKey
ALTER TABLE "daily_prices" ADD CONSTRAINT "daily_prices_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_events" ADD CONSTRAINT "dividend_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_events" ADD CONSTRAINT "dividend_events_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_receipts" ADD CONSTRAINT "dividend_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_receipts" ADD CONSTRAINT "dividend_receipts_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_receipts" ADD CONSTRAINT "dividend_receipts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "dividend_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
