-- CreateEnum
CREATE TYPE "operation_type" AS ENUM ('INITIAL_BALANCE', 'BUY', 'SELL');

-- CreateEnum
CREATE TYPE "operation_status" AS ENUM ('ACTIVE', 'CANCELED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "quote_source" AS ENUM ('MANUAL');

-- CreateTable
CREATE TABLE "funds" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT,
    "segment" TEXT,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "type" "operation_type" NOT NULL,
    "status" "operation_status" NOT NULL DEFAULT 'ACTIVE',
    "trade_date" DATE,
    "sequence" SERIAL NOT NULL,
    "quantity" DECIMAL(18,8) NOT NULL,
    "unit_price" DECIMAL(18,8) NOT NULL,
    "fees" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gross_amount" DECIMAL(18,2) NOT NULL,
    "net_amount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "quantity_after" DECIMAL(18,8),
    "average_price_after" DECIMAL(18,8),
    "cost_of_sold" DECIMAL(18,2),
    "realized_result" DECIMAL(18,2),
    "corrects_id" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "fund_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,8) NOT NULL,
    "total_cost" DECIMAL(30,12) NOT NULL,
    "realized_result" DECIMAL(30,12) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("fund_id")
);

-- CreateTable
CREATE TABLE "price_quotes" (
    "id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "source" "quote_source" NOT NULL,
    "reference_date" DATE,
    "note" TEXT,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "funds_user_id_ticker_key" ON "funds"("user_id", "ticker");

-- CreateIndex
CREATE UNIQUE INDEX "operations_corrects_id_key" ON "operations"("corrects_id");

-- CreateIndex
CREATE INDEX "operations_user_id_trade_date_idx" ON "operations"("user_id", "trade_date");

-- CreateIndex
CREATE INDEX "operations_fund_id_status_idx" ON "operations"("fund_id", "status");

-- CreateIndex
CREATE INDEX "price_quotes_fund_id_recorded_at_idx" ON "price_quotes"("fund_id", "recorded_at");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_user_id_created_at_idx" ON "audit_events"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "funds" ADD CONSTRAINT "funds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_corrects_id_fkey" FOREIGN KEY ("corrects_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
