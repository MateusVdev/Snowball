-- AlterEnum
ALTER TYPE "goal_metric" ADD VALUE 'TOTAL_PATRIMONY';

-- AlterTable
ALTER TABLE "financial_goals" ADD COLUMN     "fixed_income_simulation_id" TEXT;

-- AddForeignKey
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_fixed_income_simulation_id_fkey" FOREIGN KEY ("fixed_income_simulation_id") REFERENCES "fixed_income_simulations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
