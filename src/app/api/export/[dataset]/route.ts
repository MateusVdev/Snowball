import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { buildDataset, DATASET_KEYS, type DatasetKey } from "@/server/export/datasets";
import { toCsv, toXlsx } from "@/server/export/tabular";

export const dynamic = "force-dynamic";

/**
 * Exportação: /api/export/<conjunto>?formato=csv|xlsx
 * <conjunto> = carteira | operacoes | cotacoes | proventos | recebimentos | simulacoes | tudo (xlsx)
 * Sempre restrito aos dados do usuário autenticado.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/export/[dataset]">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { dataset } = await ctx.params;
  const format = request.nextUrl.searchParams.get("formato") === "xlsx" ? "xlsx" : "csv";
  const db = getDb();
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

  if (dataset === "tudo") {
    const all = await Promise.all(DATASET_KEYS.map((k) => buildDataset(db, user.id, k)));
    return new NextResponse(Buffer.from(toXlsx(all)), {
      headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="bola-de-neve-${stamp}.xlsx"` },
    });
  }
  if (!(DATASET_KEYS as readonly string[]).includes(dataset)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ds = await buildDataset(db, user.id, dataset as DatasetKey);
  if (format === "xlsx") {
    return new NextResponse(Buffer.from(toXlsx([ds])), {
      headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${dataset}-${stamp}.xlsx"` },
    });
  }
  return new NextResponse(toCsv(ds), {
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${dataset}-${stamp}.csv"` },
  });
}
