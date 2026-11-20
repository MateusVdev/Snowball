"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { ServiceError } from "@/server/services/errors";
import {
  addManualQuote,
  archiveFund,
  createFund,
  restoreFund,
  updateFundInfo,
} from "@/server/services/portfolio/fund-service";
import {
  cancelOperation,
  correctOperation,
  getOperation,
  registerInitialBalance,
  registerTrade,
} from "@/server/services/portfolio/operation-service";
import {
  feesSchema,
  fundInfoSchema,
  quantitySchema,
  reasonSchema,
  tickerSchema,
  tradeDateSchema,
  unitPriceSchema,
} from "@/validation/portfolio";
import { errorState, type FormState } from "./form-state";

/**
 * Server Actions da carteira. Cada action:
 * 1. exige usuário autenticado (requireUser — layouts não protegem actions);
 * 2. valida o formulário com Zod (nomes dos campos = nomes do formulário);
 * 3. chama o serviço (transacional) e devolve erros amigáveis;
 * 4. revalida as páginas e redireciona em caso de sucesso.
 */

const str = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
};

function done(path: string): never {
  revalidatePath("/", "layout");
  redirect(path);
}

const createFundFormSchema = fundInfoSchema
  .extend({
    ticker: tickerSchema,
    hasInitialBalance: z.literal("on").optional(),
    quantity: z.string().optional(),
    averagePrice: z.string().optional(),
    quotePrice: z.string().optional(),
    quoteReferenceDate: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.hasInitialBalance) {
      const q = quantitySchema.safeParse(data.quantity ?? "");
      if (!q.success) ctx.addIssue({ code: "custom", path: ["quantity"], message: q.error.issues[0].message });
      const p = unitPriceSchema.safeParse(data.averagePrice ?? "");
      if (!p.success) ctx.addIssue({ code: "custom", path: ["averagePrice"], message: p.error.issues[0].message });
    }
    if (data.quotePrice?.trim()) {
      const p = unitPriceSchema.safeParse(data.quotePrice);
      if (!p.success) ctx.addIssue({ code: "custom", path: ["quotePrice"], message: p.error.issues[0].message });
    }
  });

export async function createFundAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  let ticker: string;
  try {
    const data = createFundFormSchema.parse({
      ticker: str(formData, "ticker"),
      name: str(formData, "name"),
      segment: str(formData, "segment"),
      notes: str(formData, "notes"),
      hasInitialBalance: str(formData, "hasInitialBalance"),
      quantity: str(formData, "quantity"),
      averagePrice: str(formData, "averagePrice"),
      quotePrice: str(formData, "quotePrice"),
      quoteReferenceDate: str(formData, "quoteReferenceDate"),
    });
    const fund = await createFund(
      getDb(),
      user.id,
      { ticker: data.ticker, name: data.name ?? undefined, segment: data.segment ?? undefined, notes: data.notes ?? undefined },
      {
        initialBalance: data.hasInitialBalance
          ? { quantity: data.quantity!, averagePrice: data.averagePrice! }
          : null,
        quote: data.quotePrice?.trim()
          ? { price: data.quotePrice, referenceDate: data.quoteReferenceDate || undefined }
          : null,
      },
    );
    ticker = fund.ticker;
  } catch (error) {
    return errorState(error, formData);
  }
  done(`/carteira/${ticker}`);
}

export async function updateFundAction(
  fundId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  let ticker: string;
  try {
    const fund = await updateFundInfo(getDb(), user.id, fundId, {
      name: str(formData, "name"),
      segment: str(formData, "segment"),
      notes: str(formData, "notes"),
    });
    ticker = fund.ticker;
  } catch (error) {
    return errorState(error, formData);
  }
  done(`/carteira/${ticker}`);
}

export async function archiveFundAction(
  fundId: string,
  ticker: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    if (str(formData, "confirm")?.trim().toUpperCase() !== ticker) {
      return {
        ...errorState(new ServiceError("INVALID", `Digite ${ticker} para confirmar.`), formData),
        fieldErrors: { confirm: [`Digite ${ticker} para confirmar.`] },
      };
    }
    await archiveFund(getDb(), user.id, fundId);
  } catch (error) {
    return errorState(error, formData);
  }
  done(`/carteira`);
}

export async function restoreFundAction(
  fundId: string,
  ticker: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    await restoreFund(getDb(), user.id, fundId);
  } catch (error) {
    return errorState(error, formData);
  }
  done(`/carteira/${ticker}`);
}

export async function addQuoteAction(
  fundId: string,
  ticker: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    await addManualQuote(getDb(), user.id, fundId, {
      price: str(formData, "price") ?? "",
      referenceDate: str(formData, "referenceDate"),
      note: str(formData, "note"),
    });
  } catch (error) {
    return errorState(error, formData);
  }
  done(`/carteira/${ticker}`);
}

const tradeFormSchema = z.object({
  fundId: z.string({ error: "Selecione o fundo." }).min(1, "Selecione o fundo."),
  type: z.enum(["BUY", "SELL"], { error: "Selecione o tipo." }),
  tradeDate: tradeDateSchema,
  quantity: quantitySchema,
  unitPrice: unitPriceSchema,
  fees: feesSchema,
  notes: z.string().max(500).optional(),
});

export async function registerTradeAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  let ticker: string;
  try {
    const raw = {
      fundId: str(formData, "fundId"),
      type: str(formData, "type"),
      tradeDate: str(formData, "tradeDate"),
      quantity: str(formData, "quantity"),
      unitPrice: str(formData, "unitPrice"),
      fees: str(formData, "fees") || "0",
      notes: str(formData, "notes"),
    };
    tradeFormSchema.parse(raw); // erros por campo
    const op = await registerTrade(getDb(), user.id, raw.fundId!, {
      type: raw.type as "BUY" | "SELL",
      tradeDate: raw.tradeDate!,
      quantity: raw.quantity!,
      unitPrice: raw.unitPrice!,
      fees: raw.fees,
      notes: raw.notes,
    });
    ticker = op.ticker;
  } catch (error) {
    return errorState(error, formData);
  }
  done(`/carteira/${ticker}`);
}

export async function registerInitialBalanceAction(
  fundId: string,
  ticker: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    await registerInitialBalance(getDb(), user.id, fundId, {
      quantity: str(formData, "quantity") ?? "",
      averagePrice: str(formData, "averagePrice") ?? "",
      notes: str(formData, "notes"),
    });
  } catch (error) {
    return errorState(error, formData);
  }
  done(`/carteira/${ticker}`);
}

export async function cancelOperationAction(
  operationId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    z.object({ reason: reasonSchema }).parse({ reason: str(formData, "reason") });
    await cancelOperation(getDb(), user.id, operationId, str(formData, "reason") ?? "");
  } catch (error) {
    return errorState(error, formData);
  }
  done(`/operacoes/${operationId}`);
}

export async function correctOperationAction(
  operationId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  let newId: string;
  try {
    const db = getDb();
    const original = await getOperation(db, user.id, operationId);
    if (!original) throw new ServiceError("NOT_FOUND", "Operação não encontrada.");
    const reason = str(formData, "reason") ?? "";
    if (original.type === "INITIAL_BALANCE") {
      const input = {
        quantity: str(formData, "quantity") ?? "",
        averagePrice: str(formData, "averagePrice") ?? "",
        notes: str(formData, "notes"),
      };
      z.object({ quantity: quantitySchema, averagePrice: unitPriceSchema, reason: reasonSchema }).parse({ ...input, reason });
      newId = (await correctOperation(db, user.id, operationId, input, reason)).id;
    } else {
      const input = {
        type: original.type,
        tradeDate: str(formData, "tradeDate") ?? "",
        quantity: str(formData, "quantity") ?? "",
        unitPrice: str(formData, "unitPrice") ?? "",
        fees: str(formData, "fees") || "0",
        notes: str(formData, "notes"),
      };
      z.object({
        tradeDate: tradeDateSchema,
        quantity: quantitySchema,
        unitPrice: unitPriceSchema,
        fees: feesSchema,
        reason: reasonSchema,
      }).parse({ ...input, reason });
      newId = (await correctOperation(db, user.id, operationId, input, reason)).id;
    }
  } catch (error) {
    return errorState(error, formData);
  }
  done(`/operacoes/${newId}`);
}
