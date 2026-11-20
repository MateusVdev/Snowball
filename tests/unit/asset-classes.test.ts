import { describe, expect, it } from "vitest";
import { ASSET_CLASSES, patrimonyByClass } from "@/domain/portfolio/asset-classes";

describe("patrimônio por classe de ativo", () => {
  it("soma FIIs e renda fixa e calcula a participação", () => {
    const p = patrimonyByClass([{ key: "FII", value: "320.72" }, { key: "FIXED_INCOME", value: "91" }]);
    expect(p.total?.toFixed(2)).toBe("411.72");
    expect(p.classes.map((c) => [c.label, c.value?.toFixed(2), c.share?.toDecimalPlaces(4).toFixed()])).toEqual([
      ["FIIs", "320.72", "0.779"],
      ["Renda fixa", "91.00", "0.221"],
    ]);
  });

  it("classes sem posição ficam de fora; total desconhecido se alguma classe não tem valor", () => {
    expect(patrimonyByClass([{ key: "FII", value: "0" }, { key: "FIXED_INCOME", value: "91" }]).classes.map((c) => c.key)).toEqual(["FIXED_INCOME"]);
    const unknown = patrimonyByClass([{ key: "FII", value: null }, { key: "FIXED_INCOME", value: "91" }]);
    expect(unknown.total).toBeNull();
    expect(unknown.knownTotal.toFixed()).toBe("91");
    expect(unknown.classes.every((c) => c.share === null)).toBe(true);
    expect(patrimonyByClass([]).total?.toFixed()).toBe("0");
  });

  it("preparado para ações: basta informar a classe", () => {
    expect(ASSET_CLASSES.map((c) => c.key)).toContain("STOCKS");
    const p = patrimonyByClass([{ key: "STOCKS", value: "100" }, { key: "FII", value: "100" }]);
    expect(p.classes.map((c) => c.label)).toEqual(["FIIs", "Ações"]);
    expect(p.total?.toFixed()).toBe("200");
  });
});
