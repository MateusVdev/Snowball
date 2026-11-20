import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { exportBackup } from "@/server/export/backup";
import { recordAudit } from "@/server/services/audit";

export const dynamic = "force-dynamic";

/** Download do backup completo (JSON) do usuário autenticado. Sem credenciais. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const backup = await exportBackup(db, user.id);
  await db.$transaction((tx) => recordAudit(tx, { userId: user.id, entityType: "backup", entityId: "export", action: "backup_export", data: { checksum: backup.checksum } }));
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bola-de-neve-backup-${backup.exportedAt.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
