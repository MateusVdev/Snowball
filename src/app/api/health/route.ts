import { NextResponse } from "next/server";
import { checkDatabaseConnection } from "@/server/db/client";
import { createHealthCache } from "@/server/db/health-cache";

export const dynamic = "force-dynamic";

/**
 * Health check público: informa apenas se a aplicação e o banco respondem.
 * Não expõe mensagens de erro, versões ou dados de configuração.
 */
/** No máximo uma consulta ao banco a cada 10 s por instância (rota pública). */
const cachedDatabaseCheck = createHealthCache(checkDatabaseConnection);

export async function GET() {
  const databaseUp = await cachedDatabaseCheck();
  return NextResponse.json(
    { status: databaseUp ? "ok" : "degraded", database: databaseUp ? "up" : "down" },
    {
      status: databaseUp ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
