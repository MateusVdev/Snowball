"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { ServiceError } from "@/server/services/errors";
import {
  createSimulation,
  deleteSimulation,
  duplicateSimulation,
  restoreSimulationVersion,
  updateSimulation,
  type SimulationOrigin,
} from "@/server/services/simulation/simulation-service";
import { z } from "zod";
import { errorState, type FormState } from "./form-state";

/** Configuração inválida: mostra a primeira mensagem (não há campos individuais no formulário). */
function simulationError(error: unknown, formData: FormData): FormState {
  if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? "Configuração inválida.", ts: Date.now() };
  return errorState(error, formData);
}

/**
 * Ações do simulador. Gravam SOMENTE nas tabelas de simulação — nunca na
 * carteira real.
 */

function readConfig(formData: FormData): unknown {
  const raw = formData.get("config");
  if (typeof raw !== "string" || raw.length > 1_000_000) throw new ServiceError("INVALID", "Configuração ausente.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new ServiceError("INVALID", "Configuração inválida.");
  }
}

const meta = (formData: FormData) => ({
  name: String(formData.get("name") ?? ""),
  description: String(formData.get("description") ?? ""),
});

export async function saveSimulationAction(
  simulationId: string | null,
  origin: SimulationOrigin,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  let id: string;
  try {
    const config = readConfig(formData);
    const db = getDb();
    id = simulationId
      ? (await updateSimulation(db, user.id, simulationId, meta(formData), config)).id
      : (await createSimulation(db, user.id, meta(formData), config, origin)).id;
  } catch (error) {
    return simulationError(error, formData);
  }
  revalidatePath("/simulador", "layout");
  redirect(`/simulador/${id}`);
}

export async function duplicateSimulationAction(simulationId: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  let id: string;
  try {
    id = (await duplicateSimulation(getDb(), user.id, simulationId)).id;
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/simulador", "layout");
  redirect(`/simulador/${id}`);
}

export async function deleteSimulationAction(simulationId: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    if (formData.get("confirm") !== "on") {
      return { error: "Marque a confirmação para excluir.", ts: Date.now() };
    }
    await deleteSimulation(getDb(), user.id, simulationId);
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/simulador", "layout");
  redirect("/simulador");
}

export async function restoreVersionAction(simulationId: string, versionId: string, _: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await restoreSimulationVersion(getDb(), user.id, simulationId, versionId);
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/simulador", "layout");
  redirect(`/simulador/${simulationId}`);
}
