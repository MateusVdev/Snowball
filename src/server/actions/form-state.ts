import { z } from "zod";
import { LedgerError } from "@/domain/portfolio/ledger";
import { ServiceError, toServiceError } from "@/server/services/errors";

/** Estado devolvido pelas Server Actions de formulário. */
export interface FormState {
  error?: string;
  /** Mensagem de sucesso (ações que não redirecionam). */
  success?: string;
  /** Detalhes por item (ex.: resultado da atualização de cada fundo). */
  details?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
  /** Valores enviados, para reexibir após erro. */
  values?: Record<string, string>;
  /** Muda a cada resposta (remonta os campos). */
  ts?: number;
}

export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) {
      values[key] = value.slice(0, 1000);
    }
  }
  return values;
}

/** Converte qualquer erro em estado de formulário seguro para exibição. */
export function errorState(error: unknown, formData: FormData): FormState {
  const base = { values: formValues(formData), ts: Date.now() };
  if (error instanceof z.ZodError) {
    const flat = z.flattenError(error);
    return {
      ...base,
      error: flat.formErrors[0] ?? (Object.keys(flat.fieldErrors).length ? "Verifique os campos destacados." : error.issues[0]?.message ?? "Dados inválidos."),
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
    };
  }
  const known = toServiceError(error);
  if (known) return { ...base, error: known.message };
  console.error("[actions] erro inesperado", error);
  return { ...base, error: "Não foi possível concluir a operação. Tente novamente." };
}

export { LedgerError, ServiceError };
