import { describe, expect, it } from "vitest";
import {
  addDays,
  businessDaysBetween,
  calendarDaysBetween,
  easterSunday,
  isBusinessDay,
  isHoliday,
  nationalHolidays,
} from "@/domain/fixed-income/calendar";

describe("calendário de dias úteis", () => {
  it("calcula a Páscoa de anos conhecidos", () => {
    expect(easterSunday(2023)).toBe("2023-04-09");
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
  });

  it.each([
    // ano, carnaval (seg, ter), sexta-feira santa, corpus christi
    [2023, "2023-02-20", "2023-02-21", "2023-04-07", "2023-06-08"],
    [2024, "2024-02-12", "2024-02-13", "2024-03-29", "2024-05-30"],
    [2025, "2025-03-03", "2025-03-04", "2025-04-18", "2025-06-19"],
    [2026, "2026-02-16", "2026-02-17", "2026-04-03", "2026-06-04"],
  ])("feriados móveis de %i", (year, carnavalMon, carnavalTue, goodFriday, corpusChristi) => {
    const holidays = nationalHolidays(year);
    expect(holidays.get(carnavalMon)).toBe("Carnaval (segunda-feira)");
    expect(holidays.get(carnavalTue)).toBe("Carnaval (terça-feira)");
    expect(holidays.get(goodFriday)).toBe("Sexta-feira Santa");
    expect(holidays.get(corpusChristi)).toBe("Corpus Christi");
    for (const d of [carnavalMon, carnavalTue, goodFriday, corpusChristi]) expect(isBusinessDay(d)).toBe(false);
    // A Quarta-feira de Cinzas é dia útil (o CDI é publicado).
    expect(isBusinessDay(addDays(carnavalTue, 1))).toBe(true);
  });

  it("20/11 é feriado nacional somente a partir de 2024", () => {
    expect(isHoliday("2023-11-20")).toBe(false);
    expect(isBusinessDay("2023-11-20")).toBe(true); // segunda-feira com CDI publicado
    expect(isHoliday("2024-11-20")).toBe(true);
    expect(isHoliday("2025-11-20")).toBe(true);
    expect(isHoliday("2026-11-20")).toBe(true);
  });

  it("feriados fixos e fins de semana não são dias úteis", () => {
    for (const md of ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"]) {
      expect(isHoliday(`2025-${md}`)).toBe(true);
    }
    expect(isBusinessDay("2025-11-22")).toBe(false); // sábado
    expect(isBusinessDay("2025-11-23")).toBe(false); // domingo
    expect(isBusinessDay("2025-11-24")).toBe(true);
  });

  // Totais conferidos contra as datas publicadas na série do CDI (SGS 12) do Banco Central.
  it.each([
    [2016, 251], [2017, 249], [2018, 250], [2019, 253], [2020, 251],
    [2021, 251], [2022, 251], [2023, 249], [2024, 253], [2025, 252],
  ])("%i tem %i dias úteis (igual à série do CDI)", (year, count) => {
    expect(businessDaysBetween(`${year}-01-01`, `${year + 1}-01-01`)).toHaveLength(count);
  });

  it("intervalos: [início, fim) e dias corridos", () => {
    expect(businessDaysBetween("2025-03-10", "2025-03-24")).toHaveLength(10);
    expect(businessDaysBetween("2025-03-10", "2025-03-10")).toHaveLength(0);
    expect(calendarDaysBetween("2024-01-01", "2025-01-01")).toBe(366);
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });
});
