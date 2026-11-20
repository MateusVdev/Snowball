-- CreateEnum
CREATE TYPE "fixed_income_product_type" AS ENUM ('CDB', 'RDB', 'LCI', 'LCA', 'TESOURO_SELIC', 'OUTRO', 'PREFIXADO', 'TESOURO_IPCA');

-- CreateEnum
CREATE TYPE "fixed_income_indexer" AS ENUM ('CDI', 'SELIC', 'PRE', 'IPCA');

-- CreateEnum
CREATE TYPE "fixed_income_movement_type" AS ENUM ('DEPOSIT', 'WITHDRAWAL');

-- CreateTable
CREATE TABLE "fixed_income_assets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "product_type" "fixed_income_product_type" NOT NULL,
    "indexer" "fixed_income_indexer" NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "spread_annual_percent" DECIMAL(10,4),
    "tax_exempt" BOOLEAN NOT NULL,
    "daily_liquidity" BOOLEAN NOT NULL,
    "maturity_date" DATE,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fixed_income_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_income_movements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "type" "fixed_income_movement_type" NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fixed_income_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "index_daily_rates" (
    "indexer" "fixed_income_indexer" NOT NULL,
    "date" DATE NOT NULL,
    "daily_rate_percent" DECIMAL(14,8) NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_daily_rates_pkey" PRIMARY KEY ("indexer","date")
);

-- CreateTable
CREATE TABLE "index_sync_status" (
    "indexer" "fixed_income_indexer" NOT NULL,
    "last_attempt_at" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "index_sync_status_pkey" PRIMARY KEY ("indexer")
);

-- CreateIndex
CREATE INDEX "fixed_income_assets_user_id_idx" ON "fixed_income_assets"("user_id");

-- CreateIndex
CREATE INDEX "fixed_income_movements_asset_id_date_idx" ON "fixed_income_movements"("asset_id", "date");

-- CreateIndex
CREATE INDEX "fixed_income_movements_user_id_idx" ON "fixed_income_movements"("user_id");

-- AddForeignKey
ALTER TABLE "fixed_income_assets" ADD CONSTRAINT "fixed_income_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_income_movements" ADD CONSTRAINT "fixed_income_movements_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_income_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Proteções de integridade (somente nas tabelas novas).
ALTER TABLE "fixed_income_assets"
  ADD CONSTRAINT "fixed_income_assets_rate_positive_chk" CHECK ("rate" > 0),
  ADD CONSTRAINT "fixed_income_assets_spread_chk" CHECK ("spread_annual_percent" IS NULL OR "spread_annual_percent" > -100);
ALTER TABLE "fixed_income_movements"
  ADD CONSTRAINT "fixed_income_movements_amount_positive_chk" CHECK ("amount" > 0);
ALTER TABLE "index_daily_rates"
  ADD CONSTRAINT "index_daily_rates_rate_non_negative_chk" CHECK ("daily_rate_percent" >= 0);
