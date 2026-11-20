import { NextResponse } from "next/server";
import { checkDatabaseConnection } from "@/server/db/client";

export const dynamic = "force-dynamic";

/**
 * Health check público: informa apenas se a aplicação e o banco respondem.
 * Não expõe mensagens de erro, versões ou dados de configuração.
 */
export async function GET() {
  const databaseUp = await checkDatabaseConnection();
  return NextResponse.json(
    { status: databaseUp ? "ok" : "degraded", database: databaseUp ? "up" : "down" },
    {
      status: databaseUp ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
