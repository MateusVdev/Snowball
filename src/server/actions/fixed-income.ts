"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import {
  addFixedIncomeMovement,
  createFixedIncomeAsset,
  deleteFixedIncomeMovement,
  setFixedIncomeAssetArchived,
  updateFixedIncomeAsset,
  updateFixedIncomeMovement,
} from "@/server/services/fixed-income/fixed-income-service";
import { ensureIndexRates } from "@/server/services/fixed-income/refresh";
import { z } from "zod";
import {
  fixedIncomeMovementSchema,
  type FixedIncomeAssetFormInput,
  type FixedIncomeMovementFormInput,
} from "@/validation/fixed-income";
import { errorState, type FormState } from "./form-state";

/**
 * Server Actions da renda fixa: exigem usuário autenticado, validam com Zod
 * (no serviço) e devolvem erros amigáveis. Nomes dos campos = nomes do formulário.
 */

const str = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
};

function assetInput(formData: FormData): FixedIncomeAssetFormInput {
  return {
    name: str(formData, "name") ?? "",
    issuer: str(formData, "issuer"),
    productType: (str(formData, "productType") ?? "") as FixedIncomeAssetFormInput["productType"],
    indexer: (str(formData, "indexer") ?? "") as FixedIncomeAssetFormInput["indexer"],
    rate: str(formData, "rate") ?? "",
    spreadAnnualPercent: str(formData, "spreadAnnualPercent"),
    // Checkbox desmarcado não é enviado: sempre explícito (o formulário já
    // marca LCI/LCA automaticamente; o usuário pode desmarcar).
    taxExempt: str(formData, "taxExempt") === "on",
    dailyLiquidity: str(formData, "dailyLiquidity") === "on",
    maturityDate: str(formData, "maturityDate"),
    notes: str(formData, "notes"),
  };
}

const initialDepositSchema = z.object({
  initialAmount: fixedIncomeMovementSchema.shape.amount,
  initialDate: fixedIncomeMovementSchema.shape.date,
});

function movementInput(formData: FormData): FixedIncomeMovementFormInput {
  return {
    type: (str(formData, "type") ?? "") as FixedIncomeMovementFormInput["type"],
    date: str(formData, "date") ?? "",
    amount: str(formData, "amount") ?? "",
    notes: str(formData, "notes"),
  };
}

export async function createFixedIncomeAssetAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  let id: string;
  try {
    const db = getDb();
    const amount = str(formData, "initialAmount")?.trim();
    // Aporte inicial opcional (ex.: saldo que já existe, com data aproximada),
    // validado antes de criar o título.
    const initial = amount
      ? initialDepositSchema.parse({ initialAmount: amount, initialDate: str(formData, "initialDate") ?? "" })
      : null;
    const asset = await createFixedIncomeAsset(db, user.id, assetInput(formData));
    id = asset.id;
    if (initial) {
      await addFixedIncomeMovement(db, user.id, id, { type: "DEPOSIT", date: str(formData, "initialDate") ?? "", amount: initial.initialAmount });
    }
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/renda-fixa/${id}`);
}

export async function updateFixedIncomeAssetAction(assetId: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await updateFixedIncomeAsset(getDb(), user.id, assetId, assetInput(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/renda-fixa/${assetId}`);
}

export async function setFixedIncomeArchivedAction(assetId: string, archived: boolean, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    if (archived && formData.get("confirm") !== "on") return { error: "Marque a confirmação para arquivar.", ts: Date.now() };
    await setFixedIncomeAssetArchived(getDb(), user.id, assetId, archived);
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(archived ? "/renda-fixa" : `/renda-fixa/${assetId}`);
}

export async function addFixedIncomeMovementAction(assetId: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await addFixedIncomeMovement(getDb(), user.id, assetId, movementInput(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  return { success: str(formData, "type") === "WITHDRAWAL" ? "Resgate registrado." : "Aporte registrado.", ts: Date.now() };
}

export async function updateFixedIncomeMovementAction(movementId: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await updateFixedIncomeMovement(getDb(), user.id, movementId, movementInput(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  return { success: "Movimento atualizado.", ts: Date.now() };
}

export async function deleteFixedIncomeMovementAction(movementId: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    if (formData.get("confirm") !== "on") return { error: "Marque a confirmação para excluir.", ts: Date.now() };
    await deleteFixedIncomeMovement(getDb(), user.id, movementId);
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  return { success: "Movimento excluído.", ts: Date.now() };
}

export async function refreshIndexRatesAction(): Promise<FormState> {
  const user = await requireUser();
  const results = await ensureIndexRates(getDb(), getIntegrations().indexRates, user.id, { force: true });
  revalidatePath("/", "layout");
  const failed = results.filter((r) => r.status === "FAILED");
  if (results.length === 0) return { success: "Nada a atualizar.", ts: Date.now() };
  if (failed.length) return { error: `Não foi possível atualizar: ${failed.map((f) => f.message).join(" ")} Os valores usam os índices já guardados.`, ts: Date.now() };
  return { success: "Índices do Banco Central atualizados.", ts: Date.now() };
}
