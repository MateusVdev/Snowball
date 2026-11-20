import type { Database } from "@/server/db/factory";
import { isProviderError } from "@/server/integrations/errors";
import type { AssetInformation, AssetInformationProvider } from "@/server/integrations/types";
import { ServiceError } from "../errors";
import { recordSyncRun } from "./sync-log";

/**
 * Consulta dados cadastrais (nome, CNPJ, segmento) para SUGERIR ao usuário.
 * Nunca grava automaticamente: as fontes podem divergir (ex.: a brapi
 * informa para o MXRF11 segmento de atuação "Logística" — como declarado à
 * CVM — e classificação "papel"). O usuário escolhe o que aplicar.
 */
export async function lookupAssetInfo(
  db: Database,
  userId: string,
  provider: AssetInformationProvider,
  fundId: string,
): Promise<{ info: AssetInformation | null; error: string | null }> {
  const fund = await db.fund.findFirst({ where: { id: fundId, userId }, select: { ticker: true } });
  if (!fund) throw new ServiceError("NOT_FOUND", "Fundo não encontrado.");
  const startedAt = new Date();
  try {
    const info = await provider.getAssetInfo(fund.ticker);
    await recordSyncRun(db, {
      userId, kind: "ASSET_INFO", provider: provider.name, trigger: "manual", startedAt,
      items: [{ ticker: fund.ticker, ok: true, message: "Dados cadastrais consultados." }],
    });
    return { info, error: null };
  } catch (error) {
    const message = isProviderError(error) ? error.message : "Falha inesperada.";
    await recordSyncRun(db, {
      userId, kind: "ASSET_INFO", provider: provider.name, trigger: "manual", startedAt,
      items: [{ ticker: fund.ticker, ok: false, message }],
    });
    return { info: null, error: message };
  }
}
