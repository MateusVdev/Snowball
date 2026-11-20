-- CreateTable
CREATE TABLE "simulations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "origin" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "engine_version" TEXT NOT NULL,
    "summary" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_versions" (
    "id" TEXT NOT NULL,
    "simulation_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "engine_version" TEXT NOT NULL,
    "summary" JSONB,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "simulations_user_id_updated_at_idx" ON "simulations"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "simulation_versions_simulation_id_version_key" ON "simulation_versions"("simulation_id", "version");

-- AddForeignKey
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_versions" ADD CONSTRAINT "simulation_versions_simulation_id_fkey" FOREIGN KEY ("simulation_id") REFERENCES "simulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
