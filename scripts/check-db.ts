/**
 * Teste de conexão com o PostgreSQL: `npm run db:check`.
 * Verifica conectividade, versão do servidor e se as migrações foram aplicadas.
 */
import "dotenv/config";
import { createPrismaClient } from "@/server/db/factory";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const db = createPrismaClient(url);
  try {
    const [{ version }] = await db.$queryRaw<{ version: string }[]>`SELECT version()`;
    console.log(`✔ Conectado: ${version.split(",")[0]}`);
    const [{ count }] = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    console.log(`✔ Migrações aplicadas: ${count}`);
    console.log(`✔ Usuários cadastrados: ${await db.user.count()}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("✖ Falha na conexão com o banco:", error instanceof Error ? error.message : error);
  process.exit(1);
});
