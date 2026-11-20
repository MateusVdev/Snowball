"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { createGoal, deleteGoal, updateGoal } from "@/server/services/goals/goal-service";
import { errorState, type FormState } from "./form-state";

const input = (formData: FormData) => ({
  name: String(formData.get("name") ?? ""),
  metric: String(formData.get("metric") ?? "") as "MONTHLY_INCOME",
  target: String(formData.get("target") ?? ""),
  customCurrent: String(formData.get("customCurrent") ?? ""),
  simulationId: String(formData.get("simulationId") ?? ""),
});

export async function createGoalAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await createGoal(getDb(), user.id, input(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  return { success: "Meta criada.", ts: Date.now() };
}

export async function updateGoalAction(goalId: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await updateGoal(getDb(), user.id, goalId, input(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  return { success: "Meta atualizada.", ts: Date.now() };
}

export async function deleteGoalAction(goalId: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    if (formData.get("confirm") !== "on") return { error: "Marque a confirmação para excluir.", ts: Date.now() };
    await deleteGoal(getDb(), user.id, goalId);
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  return { success: "Meta excluída.", ts: Date.now() };
}
