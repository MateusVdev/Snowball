import "server-only";
import { getEnv } from "@/server/env";
import { createPrismaClient, type Database } from "./factory";

/**
 * Instância única (lazy) do Prisma para a aplicação Next.js.
 * - Lazy: o build de produção não exige DATABASE_URL só por importar módulos.
 * - globalThis: evita abrir novos pools a cada hot reload em desenvolvimento.
 */
const globalForPrisma = globalThis as unknown as { prisma?: Database };

export function getDb(): Database {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient(getEnv().DATABASE_URL);
  }
  return globalForPrisma.prisma;
}

/** Verifica se o banco responde. Usado pelo health check. */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
