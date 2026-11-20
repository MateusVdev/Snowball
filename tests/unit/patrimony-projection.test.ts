import { describe, expect, it } from "vitest";
import { GOAL_METRIC_LABEL } from "@/domain/goals";
import { monthsToReachTotal, projectPatrimony } from "@/domain/portfolio/patrimony-projection";

describe("simulação do patrimônio total (junção por classe)", () => {
  it("soma FIIs + renda fixa mês a mês, com a divisão por classe", () => {
    const p = projectPatrimony([
      { key: "FIXED_INCOME", source: "RF", values: ["1000", "1100", "1200"] },
      { key: "FII", source: "Bola de neve", values: ["3000", "3300", "3600"] },
    ]);
    expect(p.months.map((m) => m.total.toFixed())).toEqual(["4000", "4400", "4800"]);
    expect(p.classes.map((c) => c.key)).toEqual(["FII", "FIXED_INCOME"]); // ordem das classes, não da entrada
    expect(p.months[0].classes.map((c) => [c.label, c.share?.toFixed()])).toEqual([["FIIs", "0.75"], ["Renda fixa", "0.25"]]);
    expect(p.months[2].byClass.FIXED_INCOME?.toFixed()).toBe("1200");
    expect(p.truncated).toBe(false);
  });

  it("prazos diferentes: vai até a simulação mais curta (nada é inventado)", () => {
    const p = projectPatrimony([
      { key: "FII", source: "a", values: ["1", "2", "3", "4"] },
      { key: "FIXED_INCOME", source: "b", values: ["10", "20"] },
    ]);
    expect(p.months).toHaveLength(2);
    expect(p.truncated).toBe(true);
    expect(p.classes.find((c) => c.key === "FII")?.months).toBe(4);
  });

  it("uma classe só, sem séries e preparado para ações", () => {
    expect(projectPatrimony([{ key: "FIXED_INCOME", source: "x", values: ["5"] }]).months[0].classes.map((c) => c.key)).toEqual(["FIXED_INCOME"]);
    expect(projectPatrimony([]).months).toEqual([]);
    const withStocks = projectPatrimony([
      { key: "FII", source: "a", values: ["100"] },
      { key: "STOCKS", source: "futuro", values: ["100"] },
    ]);
    expect(withStocks.months[0].classes.map((c) => c.label)).toEqual(["FIIs", "Ações"]);
    expect(withStocks.months[0].total.toFixed()).toBe("200");
    expect(() => projectPatrimony([{ key: "FII", source: "a", values: ["1"] }, { key: "FII", source: "b", values: ["1"] }])).toThrow();
  });

  it("estimativa da meta de patrimônio total: primeiro mês que alcança", () => {
    const p = projectPatrimony([
      { key: "FII", source: "a", values: ["100", "200", "300"] },
      { key: "FIXED_INCOME", source: "b", values: ["50", "60", "70"] },
    ]);
    expect(monthsToReachTotal("260", p)).toBe(2);
    expect(monthsToReachTotal("150", p)).toBe(1);
    expect(monthsToReachTotal("1000", p)).toBeNull();
  });

  it("rótulos: metas antigas de patrimônio continuam 'só FIIs'", () => {
    expect(GOAL_METRIC_LABEL.PATRIMONY).toBe("Patrimônio (só FIIs)");
    expect(GOAL_METRIC_LABEL.TOTAL_PATRIMONY).toBe("Patrimônio total (FIIs + renda fixa)");
  });
});
