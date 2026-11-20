import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Cria um PrismaClient usando o driver adapter oficial do PostgreSQL (`pg`).
 * Usado pela aplicação (via `client.ts`), por scripts de linha de comando e testes.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export type Database = PrismaClient;
