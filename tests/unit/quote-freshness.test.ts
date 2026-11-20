import { describe, expect, it } from "vitest";
import { businessMsBetween, isQuoteStale, quoteAsOf } from "@/domain/quotes";

const H = 3600 * 1000;

describe("cotação desatualizada (horas úteis)", () => {
  it("não conta sábado e domingo", () => {
    // Sex 20/11/2026 18:00 BRT (21:00Z) → Seg 23/11 10:00 BRT (13:00Z) = 6h (sex) + 10h (seg)
    const fri = new Date("2026-11-20T21:00:00Z");
    const mon = new Date("2026-11-23T13:00:00Z");
    expect(businessMsBetween(fri, mon) / H).toBe(16);
  });

  it("fechamento de sexta não fica desatualizado no fim de semana", () => {
    const q = { source: "BRAPI" as const, marketTime: new Date("2026-11-20T21:00:00Z"), referenceDate: null, recordedAt: new Date("2026-11-20T21:05:00Z") };
    expect(isQuoteStale(q, new Date("2026-11-22T20:00:00Z"), 24)).toBe(false); // domingo
    expect(isQuoteStale(q, new Date("2026-11-24T13:00:00Z"), 24)).toBe(true); // terça
  });

  it("cotação manual usa a data de referência (fim do pregão) ou o registro", () => {
    const withRef = { source: "MANUAL" as const, marketTime: null, referenceDate: new Date("2026-11-19T00:00:00Z"), recordedAt: new Date("2026-11-20T10:00:00Z") };
    expect(quoteAsOf(withRef).toISOString()).toBe("2026-11-19T21:00:00.000Z");
    const noRef = { ...withRef, referenceDate: null };
    expect(quoteAsOf(noRef)).toEqual(noRef.recordedAt);
  });
});
