import { describe, expect, it } from "vitest";
import {
  applyScenario,
  defaultConfig,
  defaultFund,
  dividendPerShareAt,
  example96Config,
  priceAt,
  simulate,
  simulateScenarios,
  splitByWeights,
  SimulationConfigError,
  type MonthResult,
  type SimulationConfig,
} from "@/domain/simulation";
import { FinDecimal, toDecimal } from "@/domain/money";

const pick = (r: MonthResult) => ({
  startShares: r.startShares,
  dividends: r.dividendsReceived,
  cashAvailable: r.cashAvailable,
  bought: r.sharesBought,
  endShares: r.endShares,
  cashRemaining: r.cashRemaining,
});

describe("TESTE PRINCIPAL — 96 cotas, R$ 10,00, R$ 0,10/mês, 100% reinvestido, sem aporte", () => {
  const result = simulate(example96Config(12));
  const m = result.months;

  it("mês 1: 96 × 0,10 = 9,60; não compra", () => {
    expect(pick(m[0])).toEqual({ startShares: "96", dividends: "9.60", cashAvailable: "9.60", bought: "0", endShares: "96", cashRemaining: "9.60" });
  });
  it("mês 2: +9,60 → 19,20; compra 1; sobra 9,20; total 97", () => {
    expect(pick(m[1])).toEqual({ startShares: "96", dividends: "9.60", cashAvailable: "19.20", bought: "1", endShares: "97", cashRemaining: "9.20" });
  });
  it("mês 3: 97 × 0,10 = 9,70 → 18,90; compra 1; sobra 8,90; total 98", () => {
    expect(pick(m[2])).toEqual({ startShares: "97", dividends: "9.70", cashAvailable: "18.90", bought: "1", endShares: "98", cashRemaining: "8.90" });
  });
  it("mês 4: 98 × 0,10 = 9,80 → 18,70; compra 1; sobra 8,70; total 99", () => {
    expect(pick(m[3])).toEqual({ startShares: "98", dividends: "9.80", cashAvailable: "18.70", bought: "1", endShares: "99", cashRemaining: "8.70" });
  });
  it("renda futura e patrimônio", () => {
    // Mês 4: renda do mês 9,80; próxima = 99 × 0,10 = 9,90; patrimônio = 99 × 10 + 8,70 = 998,70
    expect(m[3]).toMatchObject({ monthlyIncome: "9.80", projectedNextMonthIncome: "9.90", patrimony: "998.70" });
  });
  it("compras do mês não geram dividendo no mesmo mês (cotas elegíveis = início do mês)", () => {
    expect(m[1].eligibleShares).toBe("96"); // comprou no mês 2, mas o dividendo do mês 2 usa 96
    expect(m[2].eligibleShares).toBe("97");
  });
  it("marco: primeira cota só com dividendos no mês 2", () => {
    expect(result.milestones.find((x) => x.key === "FIRST_SHARE_FROM_DIVIDENDS")?.month).toBe(2);
    expect(result.milestones.find((x) => x.key === "DIVIDENDS_EXCEED_CONTRIBUTION")?.note).toMatch(/Não se aplica/);
  });
  it("resultado é rotulado como hipotético e é determinístico", () => {
    expect(result.hypothetical).toBe(true);
    expect(simulate(example96Config(12))).toEqual(result);
  });
});

describe("saldo acumulado e cotas inteiras", () => {
  it("nunca descarta o troco e só compra cotas inteiras (120 meses)", () => {
    const r = simulate(example96Config(120));
    for (const mo of r.months) {
      expect(toDecimal(mo.sharesBought).isInteger()).toBe(true);
      expect(toDecimal(mo.cashRemaining).lt(10)).toBe(true); // sobra sempre < preço (comprou tudo que podia)
      expect(toDecimal(mo.cashRemaining).gte(0)).toBe(true);
    }
    // Conservação do caixa: entradas = gastos + saldo final
    const spent = r.months.reduce((a, x) => a.plus(x.spent), new FinDecimal(0));
    expect(spent.plus(r.summary.finalCash).toFixed(2)).toBe(toDecimal(r.summary.totalReinvested).plus(r.summary.totalContributions).toFixed(2));
  });

  it("R$ 18,90 com cota a R$ 10,00: compra 1 e mantém 8,90 para o mês seguinte", () => {
    const r = simulate(example96Config(4));
    expect(r.months[2].cashAvailable).toBe("18.90");
    expect(r.months[2].cashRemaining).toBe("8.90");
    expect(r.months[3].cashAvailable).toBe("18.70"); // 8,90 + 9,80
  });
});

describe("reinvestimento", () => {
  const cfg = (pct: "100" | "75" | "50" | "25" | "0", months = 6) =>
    defaultConfig({ months, funds: [defaultFund({ key: "A", ticker: "A", initialQuantity: "96", reinvestmentPercent: pct })] });

  it("75%: 9,60 → 7,20 reinvestido e 2,40 à parte", () => {
    const r = simulate(cfg("75"));
    expect(r.months[0]).toMatchObject({ reinvested: "7.20", notReinvested: "2.40", cashRemaining: "7.20" });
    // Mês 2: 7,20 + 7,20 = 14,40 → compra 1 → 4,40
    expect(pick(r.months[1])).toMatchObject({ cashAvailable: "14.40", bought: "1", cashRemaining: "4.40", endShares: "97" });
    expect(r.months[1].cumulativeNotReinvested).toBe("4.80");
  });

  it("50%: 4,80/mês; primeira compra no mês 3 (14,40)", () => {
    const r = simulate(cfg("50"));
    expect(r.months[1]).toMatchObject({ sharesBought: "0", cashRemaining: "9.60" });
    expect(r.months[2]).toMatchObject({ cashAvailable: "14.40", sharesBought: "1", cashRemaining: "4.40" });
  });

  it("25%: 2,40/mês; compra no mês 5 (12,00); arredondamento half-up depois", () => {
    const r = simulate(cfg("25"));
    expect(r.months[3]).toMatchObject({ cashRemaining: "9.60", sharesBought: "0" });
    expect(r.months[4]).toMatchObject({ cashAvailable: "12.00", sharesBought: "1", cashRemaining: "2.00", endShares: "97" });
    // Mês 6: 97 × 0,10 = 9,70; 25% = 2,425 → 2,43 (half-up); não reinvestido 7,27
    expect(r.months[5]).toMatchObject({ dividendsReceived: "9.70", reinvested: "2.43", notReinvested: "7.27", cashRemaining: "4.43" });
  });

  it("0%: nunca compra; todo dividendo é contabilizado à parte", () => {
    const r = simulate(cfg("0", 12));
    expect(r.summary.finalShares).toBe("96");
    expect(r.summary.totalNotReinvested).toBe("115.20"); // 12 × 9,60
    expect(r.summary.finalCash).toBe("0.00");
    expect(r.summary.finalPatrimony).toBe("960.00"); // o não reinvestido saiu do patrimônio
  });

  it("100% integral: todo dividendo vira caixa/cotas", () => {
    const r = simulate(cfg("100", 12));
    expect(r.summary.totalNotReinvested).toBe("0.00");
    expect(r.summary.totalReinvested).toBe(r.summary.totalDividendsReceived);
  });
});

describe("aportes", () => {
  it("sem aportes: total de aportes zero", () => {
    expect(simulate(example96Config(12)).summary.totalContributions).toBe("0.00");
  });

  it("aporte mensal: R$ 100/mês com 0 cotas iniciais", () => {
    const cfg = defaultConfig({ months: 3, monthlyContribution: "100", funds: [defaultFund({ key: "A", ticker: "A" })] });
    const r = simulate(cfg);
    // M1: 0 div, caixa 100 → 10 cotas; M2: 10 × 0,10 = 1,00 → 101 → 10 cotas, sobra 1,00; M3: 20 × 0,10 = 2,00 → 103 → 10, sobra 3,00
    expect(r.months.map((x) => [x.dividendsReceived, x.sharesBought, x.endShares, x.cashRemaining])).toEqual([
      ["0.00", "10", "10", "0.00"],
      ["1.00", "10", "20", "1.00"],
      ["2.00", "10", "30", "3.00"],
    ]);
    expect(r.summary.totalContributions).toBe("300.00");
  });

  it("aporte extraordinário de R$ 100 no mês 1", () => {
    const cfg = { ...example96Config(2), extraContributions: [{ month: 1, amount: "100", fundKey: null }] };
    const r = simulate(cfg);
    // M1: 9,60 + 100 = 109,60 → 10 cotas, sobra 9,60, total 106
    expect(pick(r.months[0])).toEqual({ startShares: "96", dividends: "9.60", cashAvailable: "109.60", bought: "10", endShares: "106", cashRemaining: "9.60" });
    expect(r.months[0].extraContribution).toBe("100.00");
    // M2: 106 × 0,10 = 10,60 → 20,20 → 2 cotas, sobra 0,20
    expect(pick(r.months[1])).toMatchObject({ dividends: "10.60", cashAvailable: "20.20", bought: "2", endShares: "108", cashRemaining: "0.20" });
    const ms = Object.fromEntries(r.milestones.map((x) => [x.key, x.month]));
    expect(ms.FIRST_BUY_10).toBe(1);
    expect(ms.FIRST_BUY_2).toBe(1);
    // Dividendos usados antes dos aportes: no mês 1 o dinheiro de dividendos (9,60) não paga 1 cota inteira;
    // no mês 2, 10,60 de dividendos pagam 1 cota inteira.
    expect(ms.FIRST_SHARE_FROM_DIVIDENDS).toBe(2);
  });

  it("saldo inicial entra como caixa antes do mês 1", () => {
    const r = simulate({ ...example96Config(1), initialCash: "0.40" });
    expect(r.months[0]).toMatchObject({ cashAvailable: "10.00", sharesBought: "1", cashRemaining: "0.00" });
  });
});

describe("premissas de preço e dividendo", () => {
  it("variação mensal composta, anual em degraus e alteração manual", () => {
    const monthly = { mode: "MONTHLY" as const, ratePercent: "1" };
    expect(priceAt("10", monthly, [], 1).toFixed(2)).toBe("10.00");
    expect(priceAt("10", monthly, [], 2).toFixed(2)).toBe("10.10");
    expect(priceAt("10", monthly, [], 3).toFixed(2)).toBe("10.20"); // 10,201
    expect(priceAt("10", monthly, [], 13).toFixed(2)).toBe("11.27"); // 10 × 1,01^12 = 11,2682…
    const annual = { mode: "ANNUAL" as const, ratePercent: "10" };
    expect(priceAt("10", annual, [], 12).toFixed(2)).toBe("10.00");
    expect(priceAt("10", annual, [], 13).toFixed(2)).toBe("11.00");
    expect(priceAt("10", annual, [], 25).toFixed(2)).toBe("12.10");
    // Alteração manual no mês 3 para 12,00; crescimento anual recomeça da nova base
    expect(priceAt("10", annual, [{ month: 3, value: "12" }], 5).toFixed(2)).toBe("12.00");
    expect(priceAt("10", annual, [{ month: 3, value: "12" }], 13).toFixed(2)).toBe("13.20");
    // Redução de dividendos: −2% a.a.
    expect(dividendPerShareAt("0.10", { mode: "ANNUAL", ratePercent: "-2" }, [], 13).toString()).toBe("0.098");
    expect(priceAt("10", { mode: "CONSTANT", ratePercent: "5" }, [], 100).toFixed(2)).toBe("10.00");
  });

  it("alteração de preço adia compras", () => {
    const cfg = example96Config(3);
    cfg.funds[0].priceChanges = [{ month: 2, value: "20.00" }];
    const r = simulate(cfg);
    // M2: 19,20 < 20,00 → não compra; M3: 28,80 → compra 1 → 8,80
    expect(r.months[1]).toMatchObject({ sharesBought: "0", cashRemaining: "19.20" });
    expect(r.months[2]).toMatchObject({ cashAvailable: "28.80", sharesBought: "1", cashRemaining: "8.80" });
    expect(r.months[2].patrimony).toBe("1948.80"); // 97 × 20 = 1.940 + 8,80
  });

  it("alteração de dividendo (redução para 0,05 no mês 2)", () => {
    const cfg = example96Config(3);
    cfg.funds[0].dividendChanges = [{ month: 2, value: "0.05" }];
    const r = simulate(cfg);
    // M1 9,60; M2 96 × 0,05 = 4,80 → 14,40 → compra 1 → 4,40; M3 97 × 0,05 = 4,85 → 9,25
    expect(r.months.map((x) => [x.dividendsReceived, x.cashRemaining])).toEqual([["9.60", "9.60"], ["4.80", "4.40"], ["4.85", "9.25"]]);
  });

  it("crescimento de dividendos de 1% ao mês", () => {
    const cfg = example96Config(3);
    cfg.funds[0].dividendGrowth = { mode: "MONTHLY", ratePercent: "1" };
    const r = simulate(cfg);
    // dps: 0,10; 0,101; 0,10201 → M2: 96 × 0,101 = 9,696 → 9,70; M3: 97 × 0,10201 = 9,89497 → 9,89
    expect(r.months.map((x) => x.dividendsReceived)).toEqual(["9.60", "9.70", "9.89"]);
  });
});

describe("vários fundos e estratégias", () => {
  const two = (allocation: SimulationConfig["allocation"], extra: Partial<SimulationConfig> = {}) =>
    defaultConfig({
      months: 3,
      allocation,
      funds: [
        defaultFund({ key: "A", ticker: "AAAA11", initialQuantity: "96", price: "10.00", monthlyDividend: "0.10" }),
        defaultFund({ key: "B", ticker: "BBBB11", initialQuantity: "10", price: "100.00", monthlyDividend: "1.00" }),
      ],
      ...extra,
    });

  it("mesmo fundo: cada fundo reinveste os próprios dividendos", () => {
    const r = simulate(two({ mode: "SAME_FUND", contributionWeights: {} }));
    // A: igual ao exemplo 96. B: 10/mês → caixa 10, 20, 30 (< 100) → não compra
    expect(r.months[1].funds.map((f) => [f.ticker, f.sharesBought, f.cashRemaining])).toEqual([["AAAA11", "1", "9.20"], ["BBBB11", "0", "20.00"]]);
    expect(r.months[2]).toMatchObject({ dividendsReceived: "19.70", endShares: "108", cashRemaining: "38.90" });
  });

  it("percentuais: 100% em um fundo específico", () => {
    const r = simulate(two({ mode: "WEIGHTS", weights: { A: "0", B: "100" } }));
    // Tudo vai para B: 19,60/mês → M1 19,60; M2 39,20; ... B só compra com 100
    expect(r.months[1].funds[1]).toMatchObject({ cashRemaining: "39.20", sharesBought: "0" });
    expect(r.months[1].funds[0]).toMatchObject({ cashRemaining: "0.00", sharesBought: "0" });
  });

  it("percentuais 50/50 com aporte; divisão exata em centavos", () => {
    const r = simulate(two({ mode: "WEIGHTS", weights: { A: "50", B: "50" } }, { months: 1, monthlyContribution: "0.01" }));
    // Dividendos 19,60 → 9,80/9,80; aporte 0,01 → maior fração/ordem: A
    expect(r.months[0].funds.map((f) => f.cashAvailable)).toEqual(["9.81", "9.80"]);
  });

  it("aportes divididos por percentual na estratégia 'mesmo fundo'", () => {
    const r = simulate(two({ mode: "SAME_FUND", contributionWeights: { A: "30", B: "70" } }, { months: 1, monthlyContribution: "100" }));
    // A: 9,60 + 30 = 39,60 → 3 cotas, sobra 9,60; B: 10 + 70 = 80 → 0 cotas
    expect(r.months[0].funds.map((f) => [f.contributions, f.sharesBought, f.cashRemaining])).toEqual([["30.00", "3", "9.60"], ["70.00", "0", "80.00"]]);
  });

  it("escolha manual: compra só o planejado, se houver caixa comum", () => {
    const r = simulate(two({ mode: "MANUAL", purchases: [{ month: 2, fundKey: "A", quantity: 1 }, { month: 2, fundKey: "B", quantity: 5 }] }));
    // Caixa comum: M1 19,60; M2 39,20 → A 1 (10,00) → 29,20; B: ⌊29,20/100⌋ = 0
    expect(r.months[1]).toMatchObject({ cashAvailable: "39.20", sharesBought: "1", cashRemaining: "29.20" });
    expect(r.months[1].funds[0].cashRemaining).toBeNull();
    expect(r.months[2]).toMatchObject({ sharesBought: "0", cashRemaining: "48.90" }); // sem plano no mês 3
  });

  it("aporte extraordinário direcionado a um fundo", () => {
    const r = simulate(two({ mode: "SAME_FUND", contributionWeights: {} }, { months: 1, extraContributions: [{ month: 1, amount: "90", fundKey: "B" }] }));
    expect(r.months[0].funds[1]).toMatchObject({ cashAvailable: "100.00", sharesBought: "1", cashRemaining: "0.00" });
  });

  it("divisão por pesos é exata", () => {
    const parts = splitByWeights(new FinDecimal("10"), ["a", "b", "c"].map((key) => ({ key, weight: new FinDecimal(1) })));
    expect([...parts.values()].map((v) => v.toFixed(2))).toEqual(["3.34", "3.33", "3.33"]);
  });
});

describe("elegibilidade — modelo calendário", () => {
  const cal = (dataComDay: number, purchaseDay: number, months = 3, eligibleBefore = true) => {
    const cfg = example96Config(months);
    cfg.timing = "CALENDAR";
    cfg.purchaseDay = purchaseDay;
    cfg.initialSharesEligibleBeforeStart = eligibleBefore;
    cfg.funds[0].calendar = { dataComDay, paymentDay: 15, paymentLagMonths: 1 };
    return cfg;
  };

  it("compra antes da data-com tem direito ao provento do mês (pago no mês seguinte)", () => {
    const r = simulate(cal(28, 20));
    // M1: recebe 9,60 (data-com anterior); compra dia 20: 9,60 → 0; data-com dia 28 com 96 → 9,60 (paga M2)
    // M2: recebe 9,60 → 19,20 → compra 1 (dia 20) → 9,20; data-com 28 com 97 → 9,70 (paga M3)
    // M3: recebe 9,70 → 18,90 → compra 1 → 8,90
    expect(r.months.map((x) => [x.dividendsReceived, x.dividendsGenerated, x.eligibleShares, x.endShares, x.cashRemaining])).toEqual([
      ["9.60", "9.60", "96", "96", "9.60"],
      ["9.60", "9.70", "97", "97", "9.20"],
      ["9.70", "9.80", "98", "98", "8.90"],
    ]);
  });

  it("compra depois da data-com só gera provento na data-com seguinte", () => {
    const r = simulate(cal(10, 20));
    // M2: data-com dia 10 com 96 (a cota é comprada no dia 20) → gera 9,60; M3 recebe 9,60
    expect(r.months[1]).toMatchObject({ eligibleShares: "96", dividendsGenerated: "9.60", endShares: "97" });
    expect(r.months[2]).toMatchObject({ dividendsReceived: "9.60", eligibleShares: "97" });
  });

  it("sem considerar datas-com anteriores ao início: nada a receber no mês 1", () => {
    const r = simulate(cal(28, 20, 2, false));
    expect(r.months[0].dividendsReceived).toBe("0.00");
    expect(r.months[1].dividendsReceived).toBe("9.60");
  });

  it("provento gerado no último mês fica 'a receber após o prazo'", () => {
    const r = simulate(cal(28, 20, 2));
    expect(r.summary.dividendsPendingAfterHorizon).toBe("9.70");
  });

  it("valida pagamento no mesmo mês antes da data-com", () => {
    const cfg = cal(20, 10);
    cfg.funds[0].calendar = { dataComDay: 20, paymentDay: 10, paymentLagMonths: 0 };
    expect(() => simulate(cfg)).toThrow(SimulationConfigError);
  });
});

describe("marcos e objetivos", () => {
  it("renda mensal de R$ 50/100 e objetivos personalizados", () => {
    // 500 cotas × 0,10 = 50,00 no mês 1; aporte 1.000/mês compra 100 cotas/mês
    const cfg = defaultConfig({
      months: 12,
      monthlyContribution: "1000",
      funds: [defaultFund({ key: "A", ticker: "A", initialQuantity: "500" })],
      goals: [{ id: "g1", label: "1.000 cotas", metric: "TOTAL_SHARES", target: "1000" }],
    });
    const r = simulate(cfg);
    const ms = Object.fromEntries(r.milestones.map((x) => [x.key, x.month]));
    expect(ms.INCOME_50).toBe(1);
    // M1: 50 + 1000 = 1050 → 105 cotas (fim 605); M2: 60,50 …; renda ≥ 100 quando cotas ≥ 1000
    // fins: 605, 711(M2: 60,50+1000+0? ) — verificado pela série abaixo
    const firstIncome100 = r.months.find((x) => Number(x.monthlyIncome) >= 100)!.month;
    expect(ms.INCOME_100).toBe(firstIncome100);
    expect(ms.GOAL_g1).toBe(r.months.find((x) => Number(x.endShares) >= 1000)!.month);
    expect(ms.FIRST_BUY_10).toBe(1);
    expect(ms.INCOME_1000).toBeNull();
    expect(r.milestones.find((x) => x.key === "INCOME_1000")?.note).toBe("Não atingido no prazo.");
  });

  it("dividendos superam o aporte mensal", () => {
    const cfg = defaultConfig({ months: 3, monthlyContribution: "10", funds: [defaultFund({ key: "A", ticker: "A", initialQuantity: "200" })] });
    expect(simulate(cfg).milestones.find((x) => x.key === "DIVIDENDS_EXCEED_CONTRIBUTION")?.month).toBe(1); // 20 > 10
  });
});

describe("prazos diferentes e cenários", () => {
  it("o prazo maior estende o menor sem alterá-lo", () => {
    const short = simulate(example96Config(12));
    const long = simulate(example96Config(60));
    expect(long.months.slice(0, 12)).toEqual(short.months);
    expect(long.summary.months).toBe(60);
    expect(Number(long.summary.finalShares)).toBeGreaterThan(Number(short.summary.finalShares));
  });

  it("cenário de referência = constante; cenários são hipotéticos e ordenados", () => {
    const cfg = example96Config(60);
    const results = simulateScenarios(cfg);
    expect(results.map((s) => s.scenario.key)).toEqual(["REFERENCE", "CONSERVATIVE", "MODERATE", "OPTIMISTIC"]);
    expect(results[0].result.months).toEqual(simulate(cfg).months);
    const income = results.map((s) => Number(s.result.summary.finalMonthlyIncome));
    expect(income[1]).toBeLessThan(income[0]); // dividendos −2% a.a.
    expect(results.every((s) => s.result.hypothetical)).toBe(true);
    // O cenário não altera a configuração original
    expect(applyScenario(cfg, results[3].scenario).funds[0].dividendGrowth).toEqual({ mode: "ANNUAL", ratePercent: "4" });
    expect(cfg.funds[0].dividendGrowth.mode).toBe("CONSTANT");
  });

  it("configuração inválida é recusada", () => {
    expect(() => simulate(defaultConfig({ funds: [] }))).toThrow(SimulationConfigError);
    expect(() => simulate({ ...example96Config(), funds: [defaultFund({ key: "A", ticker: "A", price: "0" })] })).toThrow(/preço/);
  });
});
