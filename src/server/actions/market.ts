"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import { ServiceError } from "@/server/services/errors";
import { runRefresh, updateUserSettings } from "@/server/services/market/auto-refresh";
import { refreshPriceHistory } from "@/server/services/market/quote-service";
import { updateFundInfo } from "@/server/services/portfolio/fund-service";
import {
  confirmPendingReceipts,
  confirmReceipt,
  registerDividendEvent,
  voidDividendEvent,
  voidReceipt,
} from "@/server/services/dividends/dividend-service";
import { dividendEventSchema, receiptSchema } from "@/validation/dividends";
import { reasonSchema } from "@/validation/portfolio";
import { errorState, formValues, type FormState } from "./form-state";

/** Server Actions de integrações (cotações, histórico, cadastro) e proventos. */

const str = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
};

function ok(message: string, details?: string[]): FormState {
  revalidatePath("/", "layout");
  return { success: message, details, ts: Date.now() };
}

function requireIntegrations() {
  const integrations = getIntegrations();
  if (!integrations.enabled) {
    throw new ServiceError("INVALID", "Integrações desativadas (INTEGRATIONS_ENABLED=false).");
  }
  return integrations;
}

export async function refreshQuotesAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const r = await runRefresh(getDb(), user.id, requireIntegrations(), { quotes: true, dividends: false }, "manual");
    if (r.skipped) return { ...ok("Uma atualização já está em andamento."), ts: Date.now() };
    const q = r.quotes!;
    const msg = q.failed
      ? `Cotações: ${q.updated} atualizada(s), ${q.unchanged} sem mudança, ${q.failed} com falha — a última cotação válida foi mantida.`
      : `Cotações: ${q.updated} atualizada(s), ${q.unchanged} sem mudança.`;
    return ok(msg, q.items.map((i) => `${i.ticker}: ${i.message}`));
  } catch (error) {
    return errorState(error, formData);
  }
}

export async function importDividendsAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const r = await runRefresh(getDb(), user.id, requireIntegrations(), { quotes: false, dividends: true }, "manual");
    if (r.skipped) return { ...ok("Uma importação já está em andamento."), ts: Date.now() };
    const results = r.dividends ?? [];
    const details = results.flatMap((p) => p.items.map((i) => `${p.provider} · ${i.ticker}: ${i.message}`));
    const created = results.reduce((a, p) => a + p.created, 0);
    const conflicts = results.reduce((a, p) => a + p.conflicts, 0);
    return ok(`Proventos: ${created} novo(s) importado(s)${conflicts ? `, ${conflicts} divergência(s) para revisar` : ""}.`, details);
  } catch (error) {
    return errorState(error, formData);
  }
}

export async function refreshPriceHistoryAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const integrations = requireIntegrations();
    if (!integrations.price) throw new ServiceError("INVALID", "Sem provedor de preços configurado.");
    const items = await refreshPriceHistory(getDb(), user.id, integrations.price, { trigger: "manual", days: 90 });
    return ok("Histórico de preços consultado.", items.map((i) => `${i.ticker}: ${i.message}`));
  } catch (error) {
    return errorState(error, formData);
  }
}

const settingsSchema = z.object({
  autoUpdateEnabled: z.boolean(),
  quoteRefreshMinutes: z.coerce.number({ error: "Informe um número." }).int().min(15, "Mínimo de 15 minutos.").max(1440),
  dividendRefreshHours: z.coerce.number({ error: "Informe um número." }).int().min(1, "Mínimo de 1 hora.").max(168),
});

export async function updateSettingsAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const data = settingsSchema.parse({
      autoUpdateEnabled: formData.get("autoUpdateEnabled") === "on",
      quoteRefreshMinutes: str(formData, "quoteRefreshMinutes"),
      dividendRefreshHours: str(formData, "dividendRefreshHours"),
    });
    await updateUserSettings(getDb(), user.id, data);
    return { ...ok("Configurações salvas."), values: formValues(formData) };
  } catch (error) {
    return errorState(error, formData);
  }
}

/** Aplica ao fundo os dados cadastrais escolhidos pelo usuário (sugestões da fonte). */
export async function applyAssetInfoAction(
  fundId: string,
  ticker: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    const db = getDb();
    const current = await db.fund.findFirst({ where: { id: fundId, userId: user.id } });
    if (!current) throw new ServiceError("NOT_FOUND", "Fundo não encontrado.");
    const pick = (field: "name" | "segment" | "cnpj") =>
      (formData.get(`apply_${field}`) === "on" ? str(formData, field) : undefined) ?? current[field] ?? undefined;
    await updateFundInfo(db, user.id, fundId, {
      name: pick("name"),
      segment: pick("segment"),
      cnpj: pick("cnpj"),
      notes: current.notes ?? undefined,
    });
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/carteira/${ticker}`);
}

// ---------------------------------------------------------------------------
// Proventos
// ---------------------------------------------------------------------------

export async function registerDividendAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  let id: string;
  try {
    const raw = {
      fundId: str(formData, "fundId") ?? "",
      kind: str(formData, "kind") as "OFFICIAL" | "FORECAST",
      type: str(formData, "type") as "INCOME" | "AMORTIZATION",
      ratePerShare: str(formData, "ratePerShare") ?? "",
      dataCom: str(formData, "dataCom") ?? "",
      paymentDate: str(formData, "paymentDate"),
      competence: str(formData, "competence"),
      notes: str(formData, "notes"),
    };
    dividendEventSchema.parse(raw);
    id = (await registerDividendEvent(getDb(), user.id, raw)).id;
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/proventos/${id}`);
}

export async function confirmReceiptAction(eventId: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const input = { quantity: str(formData, "quantity"), notes: str(formData, "notes") };
    receiptSchema.parse(input);
    await confirmReceipt(getDb(), user.id, eventId, input);
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/proventos/${eventId}`);
}

export async function confirmPendingAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const r = await confirmPendingReceipts(getDb(), user.id);
    return ok(
      `${r.created} recebimento(s) registrado(s).` +
        (r.unknown ? ` ${r.unknown} provento(s) com quantidade elegível desconhecida aguardam confirmação individual.` : ""),
    );
  } catch (error) {
    return errorState(error, formData);
  }
}

export async function voidDividendAction(eventId: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    z.object({ reason: reasonSchema }).parse({ reason: str(formData, "reason") });
    await voidDividendEvent(getDb(), user.id, eventId, str(formData, "reason") ?? "");
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/proventos/${eventId}`);
}

export async function voidReceiptAction(receiptId: string, eventId: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    z.object({ reason: reasonSchema }).parse({ reason: str(formData, "reason") });
    await voidReceipt(getDb(), user.id, receiptId, str(formData, "reason") ?? "");
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/proventos/${eventId}`);
}
