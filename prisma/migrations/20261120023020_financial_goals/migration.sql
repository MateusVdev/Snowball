-- CreateEnum
CREATE TYPE "goal_metric" AS ENUM ('MONTHLY_INCOME', 'PATRIMONY', 'TOTAL_SHARES', 'CUSTOM');

-- CreateTable
CREATE TABLE "financial_goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" "goal_metric" NOT NULL,
    "target" DECIMAL(20,2) NOT NULL,
    "custom_current" DECIMAL(20,2),
    "simulation_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financial_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_goals_user_id_idx" ON "financial_goals"("user_id");

-- AddForeignKey
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_simulation_id_fkey" FOREIGN KEY ("simulation_id") REFERENCES "simulations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
