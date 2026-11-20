import { FinDecimal, roundMoney, toDecimal } from "@/domain/money";
import { dividendPerShareAt, priceAt, splitByWeights } from "./assumptions";
import { computeMilestones } from "./milestones";
import type {
  FundMonthResult,
  MonthResult,
  SimFundConfig,
  SimulationConfig,
  SimulationResult,
} from "./types";
import { ENGINE_VERSION } from "./types";

/**
 * Motor de simulação "Bola de Neve" — puro e determinístico.
 *
 * MODELO MENSAL SIMPLIFICADO (timing = "MONTHLY"), para cada mês m:
 *   1. cotas elegíveis = cotas no INÍCIO do mês;
 *   2. dividendos = round2(cotas elegíveis × dividendo por cota de m), por fundo;
 *   3. recebidos no próprio mês; reinvestido = round2(dividendos × % reinvest.);
 *      o restante é "não reinvestido" (contabilizado à parte, sai do patrimônio);
 *   4. entram os aportes (mensal + extraordinários do mês);
 *   5. no FIM do mês, compram-se cotas inteiras: ⌊caixa ÷ preço⌋;
 *   6. o troco permanece no caixa para os meses seguintes (nunca é descartado);
 *   7. cotas compradas em m só geram dividendos a partir de m+1.
 *
 * MODELO CALENDÁRIO (timing = "CALENDAR"): cada fundo tem dia de data-com,
 * dia de pagamento e defasagem (meses). No mês, os eventos ocorrem por dia
 * (empate: pagamento → compra/aporte → data-com):
 *   - data-com: gera round2(cotas no momento × dividendo do mês), a ser pago
 *     no mês m + defasagem (após o prazo: "a receber após o prazo");
 *   - pagamento: o valor gerado entra no caixa (com o % de reinvestimento);
 *   - compra: no dia configurado, com o caixa disponível naquele momento.
 *   Assim, cotas compradas antes da data-com do mês já têm direito.
 *
 * Caixa: um por fundo (SAME_FUND e WEIGHTS) ou um caixa comum (MANUAL),
 * separando o dinheiro vindo de dividendos e de aportes. Nas compras gasta-se
 * primeiro o dinheiro de dividendos; "cotas compradas só com dividendos" são
 * as integralmente pagas por ele.
 *
 * Todos os valores em Decimal; caixa sempre em centavos exatos.
 */

const POOL = "__pool__";
const ZERO = new FinDecimal(0);

interface Bucket {
  div: FinDecimal;
  contrib: FinDecimal;
}

interface FundAcc {
  eligible: FinDecimal;
  generated: FinDecimal;
  received: FinDecimal;
  reinvested: FinDecimal;
  notReinvested: FinDecimal;
  contributions: FinDecimal;
  cashAvailable: FinDecimal | null;
  bought: FinDecimal;
  boughtDivOnly: FinDecimal;
  spent: FinDecimal;
}

export class SimulationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationConfigError";
  }
}

const MONTH_NAMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function monthLabel(startMonth: string | null, month: number): string {
  if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth)) return `Mês ${month}`;
  const [y, m] = startMonth.split("-").map(Number);
  const total = y * 12 + (m - 1) + (month - 1);
  return `Mês ${month} (${MONTH_NAMES[total % 12]}/${String(Math.floor(total / 12)).slice(-2)})`;
}

function assertConfig(config: SimulationConfig) {
  if (!Number.isInteger(config.months) || config.months < 1) throw new SimulationConfigError("Prazo inválido.");
  if (config.funds.length === 0) throw new SimulationConfigError("Inclua ao menos um fundo.");
  const keys = new Set<string>();
  for (const f of config.funds) {
    if (keys.has(f.key)) throw new SimulationConfigError(`Fundo duplicado: ${f.ticker}.`);
    keys.add(f.key);
    if (!toDecimal(f.initialQuantity).isInteger() || toDecimal(f.initialQuantity).isNegative()) {
      throw new SimulationConfigError(`${f.ticker}: quantidade inicial deve ser inteira e ≥ 0.`);
    }
    if (toDecimal(f.price).lte(0)) throw new SimulationConfigError(`${f.ticker}: preço deve ser maior que zero.`);
    if (toDecimal(f.monthlyDividend).isNegative()) throw new SimulationConfigError(`${f.ticker}: dividendo não pode ser negativo.`);
    for (const r of [f.priceGrowth, f.dividendGrowth]) {
      if (toDecimal(r.ratePercent).lte(-100)) throw new SimulationConfigError(`${f.ticker}: taxa de variação deve ser maior que −100%.`);
    }
    if (config.timing === "CALENDAR") {
      const c = f.calendar;
      if (c.paymentLagMonths === 0 && c.paymentDay <= c.dataComDay) {
        throw new SimulationConfigError(`${f.ticker}: pagamento no mesmo mês deve ser depois da data-com.`);
      }
    }
  }
  const a = config.allocation;
  if (a.mode !== "MANUAL") {
    const weights = a.mode === "SAME_FUND" ? a.contributionWeights : a.weights;
    for (const key of Object.keys(weights)) {
      if (!keys.has(key)) throw new SimulationConfigError("Pesos referem-se a fundo inexistente.");
    }
  }
}

export function simulate(config: SimulationConfig): SimulationResult {
  assertConfig(config);
  const funds = config.funds;
  const alloc = config.allocation;
  const shares = new Map(funds.map((f) => [f.key, toDecimal(f.initialQuantity)]));
  const buckets = new Map<string, Bucket>();
  for (const f of funds) buckets.set(f.key, { div: ZERO, contrib: ZERO });
  if (alloc.mode === "MANUAL") buckets.set(POOL, { div: ZERO, contrib: ZERO });

  const price = (f: SimFundConfig, m: number) => priceAt(f.price, f.priceGrowth, f.priceChanges, m);
  const dps = (f: SimFundConfig, m: number) => dividendPerShareAt(f.monthlyDividend, f.dividendGrowth, f.dividendChanges, m);
  const pct = (f: SimFundConfig) => toDecimal(f.reinvestmentPercent).dividedBy(100);

  const weightList = (w: Record<string, string>) =>
    funds.map((f) => ({ key: f.key, weight: toDecimal(w[f.key] ?? "0") }));
  const contributionWeights =
    alloc.mode === "SAME_FUND"
      ? Object.keys(alloc.contributionWeights).length
        ? weightList(alloc.contributionWeights)
        : funds.map((f) => ({ key: f.key, weight: new FinDecimal(1) })) // padrão: partes iguais
      : alloc.mode === "WEIGHTS"
        ? weightList(alloc.weights)
        : [];

  // --- entradas de caixa -----------------------------------------------------
  let accs = new Map<string, FundAcc>();
  const credit = (key: string, amount: FinDecimal, kind: "div" | "contrib") => {
    const b = buckets.get(key)!;
    b[kind] = b[kind].plus(amount);
    if (kind === "contrib" && key !== POOL) {
      const acc = accs.get(key);
      if (acc) acc.contributions = acc.contributions.plus(amount);
    }
  };
  const distributeDividend = (fundKey: string, amount: FinDecimal) => {
    if (amount.isZero()) return;
    if (alloc.mode === "SAME_FUND") credit(fundKey, amount, "div");
    else if (alloc.mode === "MANUAL") credit(POOL, amount, "div");
    else for (const [k, part] of splitByWeights(amount, contributionWeights)) if (part.gt(0)) credit(k, part, "div");
  };
  const distributeContribution = (amount: FinDecimal, target: string | null) => {
    if (amount.isZero()) return;
    if (alloc.mode === "MANUAL") return credit(POOL, amount, "contrib");
    if (target && buckets.has(target)) return credit(target, amount, "contrib");
    for (const [k, part] of splitByWeights(amount, contributionWeights)) if (part.gt(0)) credit(k, part, "contrib");
  };
  const receiveDividend = (f: SimFundConfig, amount: FinDecimal) => {
    const acc = accs.get(f.key)!;
    const reinvested = roundMoney(amount.times(pct(f)));
    acc.received = acc.received.plus(amount);
    acc.reinvested = acc.reinvested.plus(reinvested);
    acc.notReinvested = acc.notReinvested.plus(amount.minus(reinvested));
    distributeDividend(f.key, reinvested);
  };

  // Saldo inicial: tratado como aporte anterior ao mês 1.
  const initialCash = toDecimal(config.initialCash || "0");
  accs = new Map(funds.map((f) => [f.key, newAcc()]));
  distributeContribution(initialCash, null);

  // --- compras -----------------------------------------------------------------
  const spend = (bucket: Bucket, f: SimFundConfig, qty: FinDecimal, unitPrice: FinDecimal) => {
    if (qty.lte(0)) return;
    const cost = unitPrice.times(qty);
    const acc = accs.get(f.key)!;
    const divOnly = FinDecimal.min(qty, bucket.div.dividedBy(unitPrice).floor());
    const fromDiv = FinDecimal.min(bucket.div, cost);
    bucket.div = bucket.div.minus(fromDiv);
    bucket.contrib = bucket.contrib.minus(cost.minus(fromDiv));
    acc.bought = acc.bought.plus(qty);
    acc.boughtDivOnly = acc.boughtDivOnly.plus(divOnly);
    acc.spent = acc.spent.plus(cost);
    shares.set(f.key, shares.get(f.key)!.plus(qty));
  };
  const total = (b: Bucket) => b.div.plus(b.contrib);
  let cashAtPurchase = ZERO;
  const purchase = (m: number) => {
    cashAtPurchase = [...buckets.values()].reduce((a, b) => a.plus(total(b)), ZERO);
    if (alloc.mode === "MANUAL") {
      const pool = buckets.get(POOL)!;
      for (const plan of alloc.purchases.filter((p) => p.month === m)) {
        const f = funds.find((x) => x.key === plan.fundKey);
        if (!f || plan.quantity <= 0) continue;
        const p = price(f, m);
        const qty = FinDecimal.min(new FinDecimal(plan.quantity), total(pool).dividedBy(p).floor());
        spend(pool, f, qty, p);
      }
      return;
    }
    for (const f of funds) {
      const b = buckets.get(f.key)!;
      accs.get(f.key)!.cashAvailable = total(b);
      const p = price(f, m);
      spend(b, f, total(b).dividedBy(p).floor(), p);
    }
  };

  // --- calendário: pagamentos pendentes -----------------------------------------
  const pending = new Map<number, Map<string, FinDecimal>>();
  let pendingAfterHorizon = ZERO;
  const schedule = (month: number, key: string, amount: FinDecimal) => {
    if (amount.isZero()) return;
    if (month > config.months) {
      pendingAfterHorizon = pendingAfterHorizon.plus(amount);
      return;
    }
    const map = pending.get(month) ?? new Map<string, FinDecimal>();
    map.set(key, (map.get(key) ?? ZERO).plus(amount));
    pending.set(month, map);
  };
  if (config.timing === "CALENDAR" && config.initialSharesEligibleBeforeStart) {
    for (const f of funds) {
      // Datas-com anteriores ao mês 1 cujo pagamento cai dentro do prazo.
      for (let k = 1; k <= f.calendar.paymentLagMonths; k++) {
        schedule(k, f.key, roundMoney(toDecimal(f.initialQuantity).times(dps(f, 1))));
      }
    }
  }

  // --- laço mensal ---------------------------------------------------------------
  const rows: MonthResult[] = [];
  let cumDiv = ZERO;
  let cumContrib = initialCash;
  let cumNotReinvested = ZERO;

  for (let m = 1; m <= config.months; m++) {
    accs = new Map(funds.map((f) => [f.key, newAcc()]));
    const start = new Map(shares);
    const regular = toDecimal(config.monthlyContribution || "0");
    const extras = config.extraContributions.filter((e) => e.month === m);
    const extraTotal = extras.reduce((a, e) => a.plus(toDecimal(e.amount)), ZERO);
    const contribute = () => {
      distributeContribution(regular, null);
      for (const e of extras) distributeContribution(toDecimal(e.amount), e.fundKey);
    };

    if (config.timing === "MONTHLY") {
      for (const f of funds) {
        const acc = accs.get(f.key)!;
        acc.eligible = start.get(f.key)!;
        const generated = roundMoney(acc.eligible.times(dps(f, m)));
        acc.generated = generated;
        receiveDividend(f, generated);
      }
      contribute();
      purchase(m);
    } else {
      type Ev = { day: number; order: number; idx: number; run: () => void };
      const events: Ev[] = [];
      funds.forEach((f, idx) => {
        events.push({
          day: f.calendar.paymentDay, order: 0, idx,
          run: () => {
            const amount = pending.get(m)?.get(f.key);
            if (amount) {
              pending.get(m)!.delete(f.key);
              receiveDividend(f, amount);
            }
          },
        });
        events.push({
          day: f.calendar.dataComDay, order: 2, idx,
          run: () => {
            const acc = accs.get(f.key)!;
            acc.eligible = shares.get(f.key)!;
            const generated = roundMoney(acc.eligible.times(dps(f, m)));
            acc.generated = generated;
            schedule(m + f.calendar.paymentLagMonths, f.key, generated);
          },
        });
      });
      events.push({ day: config.purchaseDay, order: 1, idx: 0, run: () => { contribute(); purchase(m); } });
      events.sort((a, b) => a.day - b.day || a.order - b.order || a.idx - b.idx);
      for (const e of events) e.run();
    }

    // --- fechamento do mês ---
    const fundRows: FundMonthResult[] = funds.map((f) => {
      const acc = accs.get(f.key)!;
      const p = price(f, m);
      const end = shares.get(f.key)!;
      const b = buckets.get(f.key)!;
      return {
        key: f.key,
        ticker: f.ticker,
        price: p.toFixed(2),
        dividendPerShare: dps(f, m).toFixed(),
        startShares: start.get(f.key)!.toFixed(),
        eligibleShares: acc.eligible.toFixed(),
        dividendsGenerated: acc.generated.toFixed(2),
        dividendsReceived: acc.received.toFixed(2),
        reinvested: acc.reinvested.toFixed(2),
        notReinvested: acc.notReinvested.toFixed(2),
        contributions: acc.contributions.toFixed(2),
        cashAvailable: alloc.mode === "MANUAL" ? null : (acc.cashAvailable ?? ZERO).toFixed(2),
        sharesBought: acc.bought.toFixed(),
        sharesBoughtWithDividendsOnly: acc.boughtDivOnly.toFixed(),
        spent: acc.spent.toFixed(2),
        endShares: end.toFixed(),
        cashRemaining: alloc.mode === "MANUAL" ? null : total(b).toFixed(2),
        positionValue: end.times(p).toFixed(2),
      };
    });

    const sum = (pick: (a: FundAcc) => FinDecimal) => [...accs.values()].reduce((a, x) => a.plus(pick(x)), ZERO);
    const received = sum((a) => a.received);
    const cash = [...buckets.values()].reduce((a, b) => a.plus(total(b)), ZERO);
    const positions = funds.reduce((a, f) => a.plus(shares.get(f.key)!.times(price(f, m))), ZERO);
    const nextIncome = funds.reduce((a, f) => a.plus(roundMoney(shares.get(f.key)!.times(dps(f, m + 1)))), ZERO);
    const monthContrib = regular.plus(extraTotal);
    cumDiv = cumDiv.plus(received);
    cumContrib = cumContrib.plus(monthContrib);
    cumNotReinvested = cumNotReinvested.plus(sum((a) => a.notReinvested));

    rows.push({
      month: m,
      label: monthLabel(config.startMonth, m),
      startShares: [...start.values()].reduce((a, x) => a.plus(x), ZERO).toFixed(),
      eligibleShares: sum((a) => a.eligible).toFixed(),
      dividendsGenerated: sum((a) => a.generated).toFixed(2),
      dividendsReceived: received.toFixed(2),
      reinvested: sum((a) => a.reinvested).toFixed(2),
      notReinvested: sum((a) => a.notReinvested).toFixed(2),
      regularContribution: regular.toFixed(2),
      extraContribution: extraTotal.toFixed(2),
      cashAvailable: cashAtPurchase.toFixed(2),
      sharesBought: sum((a) => a.bought).toFixed(),
      sharesBoughtWithDividendsOnly: sum((a) => a.boughtDivOnly).toFixed(),
      spent: sum((a) => a.spent).toFixed(2),
      endShares: [...shares.values()].reduce((a, x) => a.plus(x), ZERO).toFixed(),
      cashRemaining: cash.toFixed(2),
      monthlyIncome: received.toFixed(2),
      projectedNextMonthIncome: nextIncome.toFixed(2),
      patrimony: positions.plus(cash).toFixed(2),
      cumulativeDividends: cumDiv.toFixed(2),
      cumulativeContributions: cumContrib.toFixed(2),
      cumulativeNotReinvested: cumNotReinvested.toFixed(2),
      funds: fundRows,
    });
  }

  const initialShares = funds.reduce((a, f) => a.plus(toDecimal(f.initialQuantity)), ZERO);
  const last = rows.at(-1)!;
  const initialPatrimony = funds
    .reduce((a, f) => a.plus(toDecimal(f.initialQuantity).times(price(f, 1))), ZERO)
    .plus(initialCash);

  return {
    engineVersion: ENGINE_VERSION,
    hypothetical: true,
    months: rows,
    summary: {
      months: config.months,
      initialShares: initialShares.toFixed(),
      finalShares: last.endShares,
      sharesBought: toDecimal(last.endShares).minus(initialShares).toFixed(),
      totalDividendsReceived: last.cumulativeDividends,
      dividendsPendingAfterHorizon: pendingAfterHorizon.toFixed(2),
      totalReinvested: rows.reduce((a, r) => a.plus(r.reinvested), ZERO).toFixed(2),
      totalNotReinvested: last.cumulativeNotReinvested,
      totalContributions: last.cumulativeContributions,
      initialCash: initialCash.toFixed(2),
      finalCash: last.cashRemaining,
      initialPatrimony: initialPatrimony.toFixed(2),
      finalPatrimony: last.patrimony,
      finalMonthlyIncome: last.monthlyIncome,
      projectedNextMonthIncome: last.projectedNextMonthIncome,
    },
    milestones: computeMilestones(rows, config),
  };
}

function newAcc(): FundAcc {
  return {
    eligible: ZERO, generated: ZERO, received: ZERO, reinvested: ZERO, notReinvested: ZERO,
    contributions: ZERO, cashAvailable: null, bought: ZERO, boughtDivOnly: ZERO, spent: ZERO,
  };
}
