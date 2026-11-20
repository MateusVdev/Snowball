import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/server/auth/service";
import {
  addManualQuote,
  archiveFund,
  createFund,
  getFundByTicker,
  getPortfolio,
  listQuotes,
  restoreFund,
  updateFundInfo,
} from "@/server/services/portfolio/fund-service";
import {
  cancelOperation,
  correctOperation,
  listFundOperations,
  listOperations,
  registerInitialBalance,
  registerTrade,
} from "@/server/services/portfolio/operation-service";
import { ServiceError } from "@/server/services/errors";
import { LedgerError } from "@/domain/portfolio/ledger";
import { formatPercent } from "@/domain/money";
import { createPrismaClient } from "@/server/db/factory";
import { createTestDb, resetDatabase } from "../support/db";

const db = createTestDb();
let userId: string;

beforeEach(async () => {
  await resetDatabase(db);
  const user = await createUser(db, {
    email: "investidor@teste.dev",
    name: "Investidor",
    password: "SenhaForte123",
  });
  userId = user.id;
});

afterAll(async () => {
  await db.$disconnect();
});

/** Carteira inicial informada pelo usuário. */
async function seedInitialPortfolio() {
  const mxrf = await createFund(
    db,
    userId,
    { ticker: "mxrf11" },
    {
      initialBalance: { quantity: "31", averagePrice: "8,44" },
      quote: { price: "8,52", note: "Cotação inicial manual de referência" },
    },
  );
  const hglg = await createFund(
    db,
    userId,
    { ticker: "HGLG11" },
    {
      initialBalance: { quantity: "1", averagePrice: "145,00" },
      quote: { price: "141,80", note: "Cotação inicial manual de referência" },
    },
  );
  return { mxrf, hglg };
}

const trade = (
  type: "BUY" | "SELL",
  tradeDate: string,
  quantity: string,
  unitPrice: string,
  fees = "0",
) => ({ type, tradeDate, quantity, unitPrice, fees });

describe("1. cadastro de fundos", () => {
  it("cria a carteira inicial com saldos iniciais sem data e cotações manuais", async () => {
    const { mxrf } = await seedInitialPortfolio();
    expect(mxrf.ticker).toBe("MXRF11");
    expect(mxrf.name).toBeNull(); // não inventamos nome
    expect(mxrf.segment).toBeNull();

    const ops = await listFundOperations(db, userId, mxrf.id);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: "INITIAL_BALANCE",
      tradeDate: null, // nenhuma data inventada
      quantity: "31",
      unitPrice: "8.44",
      grossAmount: "261.64",
    });

    const quotes = await listQuotes(db, userId, mxrf.id);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ price: "8.52", source: "MANUAL", referenceDate: null });

    const { positions, totals } = await getPortfolio(db, userId);
    expect(positions.map((p) => p.ticker)).toEqual(["HGLG11", "MXRF11"]);
    expect(totals.investedCapital.toFixed(2)).toBe("406.64");
    expect(totals.currentValue.toFixed(2)).toBe("405.92");
    expect(totals.unrealizedResult.toFixed(2)).toBe("-0.72");
    expect(formatPercent(totals.unrealizedReturn!)).toBe("-0,18%");
  });

  it("impede ticker duplicado e valida formato", async () => {
    await createFund(db, userId, { ticker: "MXRF11" });
    await expect(createFund(db, userId, { ticker: "mxrf11" })).rejects.toBeInstanceOf(
      ServiceError,
    );
    await expect(createFund(db, userId, { ticker: "XX" })).rejects.toThrow();
  });

  it("edita informações com auditoria e pesquisa por ticker", async () => {
    const { mxrf } = await seedInitialPortfolio();
    await updateFundInfo(db, userId, mxrf.id, { name: "Nome informado", segment: "Recebíveis" });
    const fund = await getFundByTicker(db, userId, "mxrf11");
    expect(fund).toMatchObject({ name: "Nome informado", segment: "Recebíveis" });

    const audit = await db.auditEvent.findMany({ where: { entityId: mxrf.id, action: "update" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].data).toMatchObject({ before: { name: null }, after: { name: "Nome informado" } });

    const search = await getPortfolio(db, userId, { query: "hg" });
    expect(search.positions.map((p) => p.ticker)).toEqual(["HGLG11"]);
  });

  it("remoção = arquivamento; exige posição zerada e preserva o histórico", async () => {
    const { hglg } = await seedInitialPortfolio();
    await expect(archiveFund(db, userId, hglg.id)).rejects.toThrow(/1 cota/);

    await registerTrade(db, userId, hglg.id, trade("SELL", "2026-05-04", "1", "150", "0.10"));
    await archiveFund(db, userId, hglg.id);

    const visible = await getPortfolio(db, userId);
    expect(visible.positions.map((p) => p.ticker)).toEqual(["MXRF11"]);
    const all = await getPortfolio(db, userId, { includeArchived: true });
    expect(all.positions.map((p) => p.ticker)).toEqual(["HGLG11", "MXRF11"]);
    expect(await listFundOperations(db, userId, hglg.id)).toHaveLength(2);

    // Arquivado não aceita operações até ser restaurado.
    await expect(
      registerTrade(db, userId, hglg.id, trade("BUY", "2026-05-05", "1", "150")),
    ).rejects.toThrow(/arquivado/);
    await restoreFund(db, userId, hglg.id);
    await registerTrade(db, userId, hglg.id, trade("BUY", "2026-05-05", "1", "150"));
  });

  it("isola dados por usuário", async () => {
    const { mxrf } = await seedInitialPortfolio();
    const other = await createUser(db, { email: "outro@teste.dev", name: "Outro", password: "SenhaForte123" });
    await expect(
      registerTrade(db, other.id, mxrf.id, trade("BUY", "2026-05-05", "1", "9")),
    ).rejects.toThrow(/não encontrado/);
    expect((await getPortfolio(db, other.id)).positions).toHaveLength(0);
  });
});

describe("2–9. operações, preço médio, taxas e resultados", () => {
  it("cenário completo com valores conferidos manualmente", async () => {
    const { mxrf } = await seedInitialPortfolio();

    // Compra 10 @ 8,50 + 0,30 → Q=41; C=346,94; PM=8,46195122
    const buy1 = await registerTrade(db, userId, mxrf.id, trade("BUY", "2026-02-02", "10", "8,50", "0,30"));
    expect(buy1).toMatchObject({ grossAmount: "85", netAmount: "85.3", quantityAfter: "41", averagePriceAfter: "8.46195122" });

    // Compra 9 @ 8,30 + 0,25 → Q=50; C=421,89; PM=8,4378
    await registerTrade(db, userId, mxrf.id, trade("BUY", "2026-02-10", "9", "8,30", "0,25"));
    let pos = (await getFundByTicker(db, userId, "MXRF11"))!.metrics;
    expect(pos.quantity.toString()).toBe("50");
    expect(pos.investedCapital.toFixed(2)).toBe("421.89");
    expect(pos.averagePrice!.toString()).toBe("8.4378");

    // Venda 20 @ 8,60 − 0,40 → custo vendido 168,756 → 168,76; realizado +2,844 → +2,84
    const sell = await registerTrade(db, userId, mxrf.id, trade("SELL", "2026-03-05", "20", "8,60", "0,40"));
    expect(sell).toMatchObject({
      netAmount: "171.6",
      costOfSold: "168.76",
      realizedResult: "2.84",
      quantityAfter: "30",
      averagePriceAfter: "8.4378", // PM inalterado pela venda
    });

    pos = (await getFundByTicker(db, userId, "MXRF11"))!.metrics;
    expect(pos.quantity.toString()).toBe("30");
    expect(pos.averagePrice!.toString()).toBe("8.4378");
    expect(pos.investedCapital.toString()).toBe("253.134");
    // Não realizado com cotação 8,52: 30 × 8,52 = 255,60 − 253,134 = 2,466 → 2,47
    expect(pos.currentValue!.toFixed(2)).toBe("255.60");
    expect(pos.unrealizedResult!.toFixed(2)).toBe("2.47");
    expect(pos.realizedResult.toString()).toBe("2.844");

    // Nova cotação manual 8,20: 246,00 − 253,134 = −7,134 (prejuízo não realizado)
    await addManualQuote(db, userId, mxrf.id, { price: "8,20" });
    pos = (await getFundByTicker(db, userId, "MXRF11"))!.metrics;
    expect(pos.unrealizedResult!.toFixed(2)).toBe("-7.13");

    // Venda total 30 @ 8,20 − 0,35 → realizado −7,484; total realizado −4,64
    await registerTrade(db, userId, mxrf.id, trade("SELL", "2026-04-01", "30", "8,20", "0,35"));
    pos = (await getFundByTicker(db, userId, "MXRF11"))!.metrics;
    expect(pos.quantity.isZero()).toBe(true);
    expect(pos.investedCapital.isZero()).toBe(true);
    expect(pos.realizedResult.toString()).toBe("-4.64");
  });

  it("rejeita venda acima do saldo sem gravar nada (transação desfeita)", async () => {
    const { mxrf } = await seedInitialPortfolio();
    await expect(
      registerTrade(db, userId, mxrf.id, trade("SELL", "2026-03-05", "32", "9")),
    ).rejects.toBeInstanceOf(LedgerError);
    expect(await db.operation.count({ where: { fundId: mxrf.id } })).toBe(1);
    const pos = await db.position.findUniqueOrThrow({ where: { fundId: mxrf.id } });
    expect(pos.quantity.toString()).toBe("31");
  });

  it("rejeita taxas maiores que o valor da venda", async () => {
    const { mxrf } = await seedInitialPortfolio();
    await expect(
      registerTrade(db, userId, mxrf.id, trade("SELL", "2026-03-05", "1", "1", "2")),
    ).rejects.toThrow(/taxas/);
  });

  it("vendas concorrentes não deixam o saldo negativo", async () => {
    const { hglg } = await seedInitialPortfolio();
    const results = await Promise.allSettled([
      registerTrade(db, userId, hglg.id, trade("SELL", "2026-03-05", "1", "150")),
      registerTrade(db, userId, hglg.id, trade("SELL", "2026-03-05", "1", "150")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const pos = await db.position.findUniqueOrThrow({ where: { fundId: hglg.id } });
    expect(pos.quantity.toString()).toBe("0");
  });

  it("saldo inicial pode ser registrado depois, mas só um", async () => {
    const fund = await createFund(db, userId, { ticker: "KNRI11" });
    await registerInitialBalance(db, userId, fund.id, { quantity: "2", averagePrice: "150" });
    await expect(
      registerInitialBalance(db, userId, fund.id, { quantity: "1", averagePrice: "150" }),
    ).rejects.toThrow(/já possui saldo inicial/);
  });
});

describe("5. histórico, correções e integridade", () => {
  it("corrige operação com rastreabilidade e recalcula a posição", async () => {
    const { mxrf } = await seedInitialPortfolio();
    const wrong = await registerTrade(db, userId, mxrf.id, trade("BUY", "2026-02-02", "100", "8,50"));
    const fixed = await correctOperation(
      db,
      userId,
      wrong.id,
      { tradeDate: "2026-02-02", quantity: "10", unitPrice: "8,50", fees: "0,30" },
      "Quantidade digitada errada",
    );
    expect(fixed).toMatchObject({ correctsId: wrong.id, quantityAfter: "41", type: "BUY" });

    const all = await listFundOperations(db, userId, mxrf.id);
    const original = all.find((o) => o.id === wrong.id)!;
    expect(original).toMatchObject({
      status: "SUPERSEDED",
      voidReason: "Quantidade digitada errada",
      correctedById: fixed.id,
      quantityAfter: null,
    });
    const audit = await db.auditEvent.findFirst({ where: { entityId: wrong.id, action: "correct" } });
    expect(audit?.data).toMatchObject({ before: { quantity: "100" }, after: { quantity: "10" } });

    // Uma operação substituída não pode ser corrigida/cancelada de novo.
    await expect(cancelOperation(db, userId, wrong.id, "Tentativa repetida")).rejects.toThrow(/já foi/);
  });

  it("corrige o saldo inicial", async () => {
    const { mxrf } = await seedInitialPortfolio();
    const [initial] = await listFundOperations(db, userId, mxrf.id);
    await correctOperation(db, userId, initial.id, { quantity: "30", averagePrice: "8,40" }, "Saldo conferido na corretora");
    const pos = (await getFundByTicker(db, userId, "MXRF11"))!.metrics;
    expect(pos.quantity.toString()).toBe("30");
    expect(pos.investedCapital.toFixed(2)).toBe("252.00");
  });

  it("cancelamento exige motivo e é bloqueado se quebrar o histórico", async () => {
    const fund = await createFund(db, userId, { ticker: "VISC11" });
    const buy = await registerTrade(db, userId, fund.id, trade("BUY", "2026-01-10", "5", "100"));
    await registerTrade(db, userId, fund.id, trade("SELL", "2026-01-20", "5", "110"));

    await expect(cancelOperation(db, userId, buy.id, "")).rejects.toThrow();
    // Cancelar a compra deixaria a venda sem cotas → rejeitado e nada muda.
    await expect(cancelOperation(db, userId, buy.id, "Compra duplicada")).rejects.toBeInstanceOf(LedgerError);
    expect((await db.operation.findUniqueOrThrow({ where: { id: buy.id } })).status).toBe("ACTIVE");
  });

  it("cancelamento válido remove a operação do cálculo, mas não do histórico", async () => {
    const { mxrf } = await seedInitialPortfolio();
    const buy = await registerTrade(db, userId, mxrf.id, trade("BUY", "2026-02-02", "10", "8,50"));
    await cancelOperation(db, userId, buy.id, "Ordem não executada");
    const pos = (await getFundByTicker(db, userId, "MXRF11"))!.metrics;
    expect(pos.quantity.toString()).toBe("31");

    const active = await listOperations(db, userId, { fund: "MXRF11" });
    expect(active.operations).toHaveLength(1);
    const all = await listOperations(db, userId, { fund: "MXRF11", status: "all" });
    expect(all.operations).toHaveLength(2);
    expect(all.operations.find((o) => o.id === buy.id)?.status).toBe("CANCELED");
  });

  it("filtra por fundo, período e tipo", async () => {
    const { mxrf, hglg } = await seedInitialPortfolio();
    await registerTrade(db, userId, mxrf.id, trade("BUY", "2026-01-15", "1", "8.5"));
    await registerTrade(db, userId, mxrf.id, trade("BUY", "2026-02-15", "1", "8.5"));
    await registerTrade(db, userId, hglg.id, trade("BUY", "2026-02-20", "1", "140"));
    await registerTrade(db, userId, mxrf.id, trade("SELL", "2026-03-15", "1", "8.7"));

    const feb = await listOperations(db, userId, { from: "2026-02-01", to: "2026-02-28" });
    expect(feb.operations.map((o) => o.ticker)).toEqual(["HGLG11", "MXRF11"]);

    const mxrfOnly = await listOperations(db, userId, { fund: "mxrf11" });
    expect(mxrfOnly.operations).toHaveLength(4); // 3 datadas + saldo inicial (por último)
    expect(mxrfOnly.operations.at(-1)?.type).toBe("INITIAL_BALANCE");

    const sells = await listOperations(db, userId, { type: "SELL" });
    expect(sells.operations).toHaveLength(1);
  });

  it("o banco impede excluir ou alterar operações diretamente", async () => {
    const { mxrf } = await seedInitialPortfolio();
    const [op] = await listFundOperations(db, userId, mxrf.id);
    await expect(db.operation.delete({ where: { id: op.id } })).rejects.toThrow(/não podem ser excluídas/);
    await expect(
      db.operation.update({ where: { id: op.id }, data: { quantity: "99" } }),
    ).rejects.toThrow(/imutáveis/);
    await expect(db.fund.delete({ where: { id: mxrf.id } })).rejects.toThrow();
    await expect(db.auditEvent.deleteMany({})).rejects.toThrow(/somente inserção/);
  });

  it("cache da posição é consistente com o reprocessamento das operações", async () => {
    const { mxrf } = await seedInitialPortfolio();
    await registerTrade(db, userId, mxrf.id, trade("BUY", "2026-02-02", "10", "8,50", "0,30"));
    await registerTrade(db, userId, mxrf.id, trade("SELL", "2026-03-05", "7", "8,90", "0,20"));
    const ops = await db.operation.findMany({ where: { fundId: mxrf.id, status: "ACTIVE" } });
    const { replayLedger } = await import("@/domain/portfolio/ledger");
    const replay = replayLedger(
      ops.map((o) => ({ ...o, quantity: o.quantity.toString(), unitPrice: o.unitPrice.toString(), fees: o.fees.toString() })),
    );
    const cached = await db.position.findUniqueOrThrow({ where: { fundId: mxrf.id } });
    expect(cached.quantity.toString()).toBe(replay.final.quantity.toString());
    expect(cached.totalCost.toFixed(8)).toBe(replay.final.totalCost.toFixed(8));
    expect(cached.realizedResult.toFixed(8)).toBe(replay.final.realizedResult.toFixed(8));
  });
});

describe("10. persistência após reiniciar", () => {
  it("dados permanecem após encerrar e abrir uma nova conexão", async () => {
    const { mxrf } = await seedInitialPortfolio();
    await registerTrade(db, userId, mxrf.id, trade("BUY", "2026-02-02", "10", "8,50", "0,30"));

    // Simula reinício: novo cliente, novo pool de conexões.
    const fresh = createPrismaClient(process.env.DATABASE_URL!);
    try {
      const pos = (await getFundByTicker(fresh, userId, "MXRF11"))!.metrics;
      expect(pos.quantity.toString()).toBe("41");
      expect(pos.investedCapital.toFixed(2)).toBe("346.94");
      const { totals } = await getPortfolio(fresh, userId);
      expect(totals.investedCapital.toFixed(2)).toBe("491.94");
    } finally {
      await fresh.$disconnect();
    }
  });
});
