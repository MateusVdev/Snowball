import { NextResponse, type NextRequest } from "next/server";
import { secretsEqual } from "@/server/auth/tokens";
import { purgeExpiredAuthData } from "@/server/auth/service";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { getIntegrations } from "@/server/integrations/registry";
import { runRefresh } from "@/server/services/market/auto-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Atualização agendada por um agendador externo (cron do sistema, GitHub
 * Actions etc.):  curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/refresh
 * Desabilitado (404) se CRON_SECRET não estiver definido.
 * Parâmetros opcionais: ?quotes=0 ou ?dividends=0 para pular uma parte.
 */
function authorized(request: NextRequest, secret: string) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return secretsEqual(token, secret);
}

export async function GET(request: NextRequest) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!authorized(request, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Retenção: remove sessões vencidas e tentativas de login com mais de 90 dias.
  await purgeExpiredAuthData(getDb()).catch((error) => console.error("[cron] limpeza de dados de autenticação falhou", error));

  const integrations = getIntegrations();
  if (!integrations.enabled) return NextResponse.json({ status: "disabled" });
  const what = {
    quotes: request.nextUrl.searchParams.get("quotes") !== "0",
    dividends: request.nextUrl.searchParams.get("dividends") !== "0",
  };
  const db = getDb();
  const users = await db.user.findMany({ select: { id: true } });
  const summary = [];
  for (const user of users) {
    const r = await runRefresh(db, user.id, integrations, what, "cron");
    summary.push({
      skipped: r.skipped,
      quotes: r.skipped || !r.quotes ? null : { updated: r.quotes.updated, unchanged: r.quotes.unchanged, failed: r.quotes.failed },
      dividends: r.skipped || !r.dividends ? null : r.dividends.map((d) => ({ provider: d.provider, created: d.created, duplicates: d.duplicates, conflicts: d.conflicts, failed: d.failedFunds })),
    });
  }
  return NextResponse.json({ status: "ok", users: summary }, { headers: { "Cache-Control": "no-store" } });
}
