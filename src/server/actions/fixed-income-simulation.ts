"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import {
  deleteFixedIncomeSimulation,
  saveFixedIncomeSimulation,
} from "@/server/services/fixed-income/simulation-service";
import { errorState, type FormState } from "./form-state";

const FIELDS = ["initialAmount", "monthlyContribution", "termValue", "termUnit", "rateMode", "cdiPercent", "annualRatePercent", "cdiAnnualPercent", "taxExempt", "startDate"] as const;

function params(formData: FormData) {
  const out: Record<string, string | undefined> = {};
  for (const f of FIELDS) {
    const v = formData.get(f);
    out[f] = typeof v === "string" ? v : undefined;
  }
  return out as never;
}

export async function saveFixedIncomeSimulationAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  let id: string;
  try {
    const existing = formData.get("id");
    id = await saveFixedIncomeSimulation(getDb(), user.id, {
      name: String(formData.get("name") ?? ""),
      params: params(formData),
      id: formData.get("saveAs") === "new" || typeof existing !== "string" || !existing ? null : existing,
    });
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/renda-fixa/simulador/${id}`);
}

export async function deleteFixedIncomeSimulationAction(id: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    if (formData.get("confirm") !== "on") return { error: "Marque a confirmação para excluir.", ts: Date.now() };
    await deleteFixedIncomeSimulation(getDb(), user.id, id);
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  redirect("/renda-fixa/simulador");
}
