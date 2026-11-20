import "server-only";
import type { Database } from "@/server/db/factory";
import { getPortfolio } from "@/server/services/portfolio/fund-service";
import { listFixedIncomeAssets } from "@/server/services/fixed-income/fixed-income-service";
import { PRODUCT_TYPE_LABEL, rateLabel } from "@/domain/fixed-income/labels";
import { fromIso } from "@/domain/fixed-income/calendar";
import { date, num, text, type Dataset } from "./tabular";

/** Conjuntos de dados exportáveis (sempre filtrados pelo usuário autenticado). */
export const DATASET_KEYS = ["carteira", "operacoes", "cotacoes", "proventos", "recebimentos", "simulacoes", "renda-fixa", "renda-fixa-movimentos"] as const;
export type DatasetKey = (typeof DATASET_KEYS)[number];

export const DATASET_LABELS: Record<DatasetKey, string> = {
  carteira: "Carteira",
  operacoes: "Operações",
  cotacoes: "Cotações",
  proventos: "Proventos",
  recebimentos: "Recebimentos",
  simulacoes: "Simulações",
  "renda-fixa": "Renda fixa",
  "renda-fixa-movimentos": "Renda fixa — movimentos",
};

const m2 = (v: { toDecimalPlaces(n: number): { toFixed(n: number): string } }) => v.toDecimalPlaces(2).toFixed(2);

export async function buildDataset(db: Database, userId: string, key: DatasetKey): Promise<Dataset> {
  switch (key) {
    case "carteira": {
      const { positions } = await getPortfolio(db, userId, { includeArchived: true });
      return {
        name: DATASET_LABELS.carteira,
        columns: ["Ticker", "Nome", "Segmento", "CNPJ", "Cotas", "Preço médio", "Capital investido", "Cotação", "Origem da cotação", "Cotação referente a", "Valor atual", "Resultado não realizado", "Rentabilidade", "Resultado realizado", "Arquivado em"],
        rows: positions.map((p) => [
          text(p.ticker), text(p.name), text(p.segment), text(p.cnpj),
          num(p.metrics.quantity.toFixed()), num(p.metrics.averagePrice?.toDecimalPlaces(8).toFixed() ?? null),
          num(p.metrics.investedCapital.toDecimalPlaces(2).toFixed(2)), num(p.metrics.currentPrice?.toFixed() ?? null),
          text(p.quote?.source ?? null), date(p.quote?.asOf ?? null, true),
          num(p.metrics.currentValue?.toDecimalPlaces(2).toFixed(2) ?? null), num(p.metrics.unrealizedResult?.toDecimalPlaces(2).toFixed(2) ?? null),
          num(p.metrics.unrealizedReturn?.toDecimalPlaces(6).toFixed() ?? null), num(p.metrics.realizedResult.toDecimalPlaces(2).toFixed(2)),
          date(p.archivedAt, true),
        ]),
      };
    }
    case "operacoes": {
      const ops = await db.operation.findMany({ where: { userId }, include: { fund: { select: { ticker: true } } }, orderBy: [{ tradeDate: { sort: "asc", nulls: "first" } }, { sequence: "asc" }] });
      return {
        name: DATASET_LABELS.operacoes,
        columns: ["ID", "Fundo", "Tipo", "Situação", "Data", "Quantidade", "Preço unitário", "Taxas", "Valor bruto", "Valor total/líquido", "Cotas após", "PM após", "Custo vendido", "Resultado realizado", "Corrige", "Motivo (cancelamento/correção)", "Observações", "Registrada em"],
        rows: ops.map((o) => [
          text(o.id), text(o.fund.ticker), text(o.type), text(o.status), date(o.tradeDate), num(o.quantity.toString()), num(o.unitPrice.toString()),
          num(o.fees.toString()), num(o.grossAmount.toString()), num(o.netAmount.toString()), num(o.quantityAfter?.toString() ?? null),
          num(o.averagePriceAfter?.toString() ?? null), num(o.costOfSold?.toString() ?? null), num(o.realizedResult?.toString() ?? null),
          text(o.correctsId), text(o.voidReason), text(o.notes), date(o.createdAt, true),
        ]),
      };
    }
    case "cotacoes": {
      const quotes = await db.priceQuote.findMany({ where: { fund: { userId } }, include: { fund: { select: { ticker: true } } }, orderBy: { recordedAt: "asc" } });
      return {
        name: DATASET_LABELS.cotacoes,
        columns: ["Fundo", "Preço", "Origem", "Horário de mercado", "Data de referência", "Fechamento anterior", "Variação %", "Registrada em", "Observação"],
        rows: quotes.map((q) => [
          text(q.fund.ticker), num(q.price.toString()), text(q.source), date(q.marketTime, true), date(q.referenceDate),
          num(q.previousClose?.toString() ?? null), num(q.changePercent?.toString() ?? null), date(q.recordedAt, true), text(q.note),
        ]),
      };
    }
    case "proventos": {
      const events = await db.dividendEvent.findMany({ where: { userId }, include: { fund: { select: { ticker: true } } }, orderBy: [{ dataCom: "asc" }] });
      return {
        name: DATASET_LABELS.proventos,
        columns: ["ID", "Fundo", "Natureza", "Tipo", "Fonte", "Valor por cota", "Data-com", "Pagamento", "Competência", "Referência na fonte", "Conferido", "Anulado em", "Motivo", "Observações"],
        rows: events.map((e) => [
          text(e.id), text(e.fund.ticker), text(e.kind), text(e.type), text(e.source), num(e.ratePerShare.toString()), date(e.dataCom), date(e.paymentDate),
          text(e.competence), text(e.referenceLabel), text(e.verified === null ? null : e.verified ? "sim" : "não"), date(e.voidedAt, true), text(e.voidReason), text(e.notes),
        ]),
      };
    }
    case "recebimentos": {
      const rec = await db.dividendReceipt.findMany({ where: { userId }, include: { fund: { select: { ticker: true } }, event: { select: { type: true, dataCom: true } } }, orderBy: { paymentDate: "asc" } });
      return {
        name: DATASET_LABELS.recebimentos,
        columns: ["Fundo", "Tipo", "Data-com", "Pagamento", "Cotas elegíveis", "Origem da quantidade", "Valor por cota", "Valor recebido", "Anulado em", "Motivo"],
        rows: rec.map((r) => [
          text(r.fund.ticker), text(r.event.type), date(r.event.dataCom), date(r.paymentDate), num(r.eligibleQuantity.toString()), text(r.quantitySource),
          num(r.ratePerShare.toString()), num(r.totalAmount.toString()), date(r.voidedAt, true), text(r.voidReason),
        ]),
      };
    }
    case "simulacoes": {
      const sims = await db.simulation.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
      return {
        name: DATASET_LABELS.simulacoes,
        columns: ["Nome", "Origem", "Prazo (meses)", "Cotas finais", "Renda mensal final", "Patrimônio final", "Dividendos recebidos", "Versão do motor", "Atualizada em"],
        rows: sims.map((s) => {
          const sum = (s.summary ?? {}) as Record<string, string | number>;
          return [text(s.name), text(s.origin), num(sum.months ?? null), num(sum.finalShares ?? null), num(sum.finalMonthlyIncome ?? null), num(sum.finalPatrimony ?? null), num(sum.totalDividendsReceived ?? null), text(s.engineVersion), date(s.updatedAt, true)];
        }),
      };
    }
    case "renda-fixa": {
      // Valores estimados na data de hoje (CDI/Selic do Banco Central).
      const { assets } = await listFixedIncomeAssets(db, userId, { includeArchived: true });
      return {
        name: DATASET_LABELS["renda-fixa"],
        columns: ["ID", "Nome", "Emissor", "Tipo", "Rentabilidade", "Isento de IR", "Liquidez diária", "Vencimento", "Total aportado", "Valor aplicado", "Bruto estimado", "IOF estimado", "IR estimado", "Líquido estimado", "Rendimento no mês", "Rendimento acumulado", "Índices até", "Arquivado em", "Observações"],
        rows: assets.map((a) => {
          const r = a.result;
          return [
            text(a.id), text(a.name), text(a.issuer), text(PRODUCT_TYPE_LABEL[a.productType] ?? a.productType), text(rateLabel(a.rate, a.indexer, a.spreadAnnualPercent)),
            text(a.taxExempt ? "sim" : "não"), text(a.dailyLiquidity ? "sim" : "não"), date(a.maturityDate ? fromIso(a.maturityDate) : null),
            num(m2(r.totalDeposited)), num(m2(r.current.principal)), num(m2(r.current.gross)), num(m2(r.current.iof)), num(m2(r.current.incomeTax)),
            num(m2(r.current.net)), num(m2(r.monthEarnings)), num(m2(r.accumulatedEarnings)), date(r.ratesKnownUntil ? fromIso(r.ratesKnownUntil) : null),
            date(a.archivedAt, true), text(a.notes),
          ];
        }),
      };
    }
    case "renda-fixa-movimentos": {
      const { assets } = await listFixedIncomeAssets(db, userId, { includeArchived: true });
      const rows = assets.flatMap((a) => {
        const byId = new Map(a.result.withdrawals.map((w) => [w.movementId, w]));
        return a.movements.map((m) => {
          const w = byId.get(m.id);
          return [
            text(m.id), text(a.name), text(m.type === "DEPOSIT" ? "Aporte" : "Resgate"), date(fromIso(m.date)), num(m.amount),
            num(w ? m2(w.gross) : null), num(w ? m2(w.iof) : null), num(w ? m2(w.incomeTax) : null), text(m.notes),
          ];
        });
      });
      return {
        name: DATASET_LABELS["renda-fixa-movimentos"],
        columns: ["ID", "Título", "Tipo", "Data", "Valor (aporte; resgate = líquido recebido)", "Resgate: bruto equivalente", "Resgate: IOF estimado", "Resgate: IR estimado", "Observações"],
        rows,
      };
    }
  }
}
