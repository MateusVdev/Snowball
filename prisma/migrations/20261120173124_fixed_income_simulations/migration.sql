-- CreateTable
CREATE TABLE "fixed_income_simulations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "summary" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fixed_income_simulations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fixed_income_simulations_user_id_idx" ON "fixed_income_simulations"("user_id");

-- AddForeignKey
ALTER TABLE "fixed_income_simulations" ADD CONSTRAINT "fixed_income_simulations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
