import { createPrismaClient, type Database } from "@/server/db/factory";

export function createTestDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL de teste não definida.");
  return createPrismaClient(url);
}

/** Limpa todas as tabelas de domínio (mantém o histórico de migrações). */
export async function resetDatabase(db: Database) {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "financial_goals", "simulation_versions", "simulations", "sync_runs", "user_settings", "dividend_receipts", "dividend_events", "daily_prices", "audit_events", "price_quotes", "positions", "operations", "funds", "login_attempts", "sessions", "users" RESTART IDENTITY CASCADE',
  );
}
