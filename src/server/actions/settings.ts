"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/dal";
import { changePassword, revokeOtherSessions, verifyUserPassword } from "@/server/auth/service";
import { clearSessionCookie, readSessionToken } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { recordAudit } from "@/server/services/audit";
import { restoreBackup } from "@/server/export/backup";
import { ServiceError } from "@/server/services/errors";
import { newPasswordSchema } from "@/validation/auth";
import { errorState, type FormState } from "./form-state";

/** Configurações da conta e restauração de backup. */

export async function updateProfileAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const name = z.string().trim().min(1, "Informe o nome.").max(100).parse(formData.get("name"));
    const db = getDb();
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { name } });
      await recordAudit(tx, { userId: user.id, entityType: "user", entityId: user.id, action: "update_profile", data: { name } });
    });
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/", "layout");
  return { success: "Perfil atualizado.", ts: Date.now() };
}

const passwordForm = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual.").max(256),
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ["confirmPassword"], message: "As senhas não conferem." })
  .refine((d) => d.newPassword !== d.currentPassword, { path: ["newPassword"], message: "A nova senha deve ser diferente da atual." });

/** Troca a senha. Por segurança, encerra TODAS as sessões (inclusive esta). */
export async function changePasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const data = passwordForm.parse({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });
    const db = getDb();
    if (!(await verifyUserPassword(db, user.id, data.currentPassword))) {
      return { error: "Senha atual incorreta.", fieldErrors: { currentPassword: ["Senha atual incorreta."] }, ts: Date.now() };
    }
    await changePassword(db, user.id, data.newPassword);
    await db.$transaction((tx) => recordAudit(tx, { userId: user.id, entityType: "user", entityId: user.id, action: "change_password" }));
  } catch (error) {
    // Nunca devolve as senhas digitadas ao formulário.
    const state = errorState(error, new FormData());
    return { ...state, values: undefined };
  }
  await clearSessionCookie();
  redirect("/login?senha=alterada");
}

export async function revokeOtherSessionsAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const token = await readSessionToken();
    if (!token) throw new ServiceError("INVALID", "Sessão atual não encontrada.");
    const count = await revokeOtherSessions(getDb(), user.id, token);
    revalidatePath("/configuracoes");
    return { success: `${count} outra(s) sessão(ões) encerrada(s).`, ts: Date.now() };
  } catch (error) {
    return errorState(error, formData);
  }
}

const MAX_BACKUP_BYTES = 7 * 1024 * 1024;

export async function restoreBackupAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const file = formData.get("backup");
    if (!(file instanceof File) || file.size === 0) throw new ServiceError("INVALID", "Selecione o arquivo de backup (.json).");
    if (file.size > MAX_BACKUP_BYTES) throw new ServiceError("INVALID", "Arquivo grande demais (máximo 7 MB).");
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      throw new ServiceError("INVALID", "O arquivo não é um JSON válido.");
    }
    const r = await restoreBackup(getDb(), user.id, raw);
    revalidatePath("/", "layout");
    return {
      success: `Backup restaurado: ${r.funds} fundo(s), ${r.operations} operação(ões), ${r.dividendEvents} provento(s), ${r.receipts} recebimento(s), ${r.simulations} simulação(ões), ${r.goals} meta(s), ${r.fixedIncomeAssets} título(s) de renda fixa com ${r.fixedIncomeMovements} movimento(s), ${r.fixedIncomeSimulations} simulação(ões) de renda fixa.`,
      ts: Date.now(),
    };
  } catch (error) {
    return errorState(error, new FormData());
  }
}
