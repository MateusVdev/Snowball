import { describe, expect, it } from "vitest";
import { BcbSgsProvider, parseSgsResponse, splitWindows } from "@/server/integrations/bcb/sgs";
import { RequestLimiter } from "@/server/integrations/limiter";
import { ProviderError } from "@/server/integrations/errors";

/** Respostas SIMULADAS da API do Banco Central — somente nos testes. */
function fakeFetch(handler: (url: URL) => { status: number; body: string }) {
  const calls: URL[] = [];
  const impl = async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    const { status, body } = handler(url);
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

const limiter = () => new RequestLimiter({ maxConcurrent: 1, minIntervalMs: 0 });

describe("BCB SGS", () => {
  it("monta a URL da série e converte a resposta (CDI = 12, Selic = 11)", async () => {
    const f = fakeFetch(() => ({ status: 200, body: '[{"data":"02/01/2025","valor":"0.045513"},{"data":"03/01/2025","valor":"0.045513"}]' }));
    const p = new BcbSgsProvider({ fetchImpl: f.impl, limiter: limiter() });
    const rates = await p.getDailyRates("CDI", "2025-01-01", "2025-01-03");
    expect(rates).toEqual([
      { date: "2025-01-02", dailyRatePercent: "0.045513" },
      { date: "2025-01-03", dailyRatePercent: "0.045513" },
    ]);
    expect(f.calls[0].pathname).toBe("/dados/serie/bcdata.sgs.12/dados");
    expect(f.calls[0].searchParams.get("dataInicial")).toBe("01/01/2025");
    expect(f.calls[0].searchParams.get("dataFinal")).toBe("03/01/2025");
    expect(f.calls[0].searchParams.get("formato")).toBe("json");
    await p.getDailyRates("SELIC", "2025-01-01", "2025-01-03");
    expect(f.calls[1].pathname).toBe("/dados/serie/bcdata.sgs.11/dados");
  });

  it("HTTP 404 (Value(s) not found) = sem dados no intervalo", async () => {
    const f = fakeFetch(() => ({
      status: 404,
      body: '{"erro":{"statusCode":404,"detail":"br.gov.bcb.pec.sgs.comum.excecoes.SGSNegocioException: Value(s) not found"}}',
    }));
    const p = new BcbSgsProvider({ fetchImpl: f.impl, limiter: limiter() });
    expect(await p.getDailyRates("CDI", "2025-01-04", "2025-01-05")).toEqual([]);
  });

  it("divide janelas longas (limite de 10 anos da API)", async () => {
    expect(splitWindows("2010-01-01", "2010-01-10", 4)).toEqual([
      ["2010-01-01", "2010-01-04"],
      ["2010-01-05", "2010-01-08"],
      ["2010-01-09", "2010-01-10"],
    ]);
    const f = fakeFetch(() => ({ status: 200, body: "[]" }));
    const p = new BcbSgsProvider({ fetchImpl: f.impl, limiter: limiter() });
    await p.getDailyRates("CDI", "2012-01-01", "2026-11-20");
    expect(f.calls.length).toBe(3);
    expect(f.calls[0].searchParams.get("dataInicial")).toBe("01/01/2012");
    expect(f.calls[2].searchParams.get("dataFinal")).toBe("20/11/2026");
  });

  it("falhas viram ProviderError (indisponível, formato inválido, timeout)", async () => {
    const down = new BcbSgsProvider({ fetchImpl: fakeFetch(() => ({ status: 503, body: "" })).impl, limiter: limiter() });
    await expect(down.getDailyRates("CDI", "2025-01-01", "2025-01-03")).rejects.toMatchObject({ kind: "UNAVAILABLE" });

    const bad = new BcbSgsProvider({ fetchImpl: fakeFetch(() => ({ status: 200, body: '[{"data":"2025-01-02","valor":"x"}]' })).impl, limiter: limiter() });
    await expect(bad.getDailyRates("CDI", "2025-01-01", "2025-01-03")).rejects.toMatchObject({ kind: "INVALID_RESPONSE" });

    const html = new BcbSgsProvider({ fetchImpl: fakeFetch(() => ({ status: 200, body: "<html>" })).impl, limiter: limiter() });
    await expect(html.getDailyRates("CDI", "2025-01-01", "2025-01-03")).rejects.toBeInstanceOf(ProviderError);

    const slow = new BcbSgsProvider({
      fetchImpl: (_url, init) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
      limiter: limiter(),
      timeoutMs: 20,
    });
    await expect(slow.getDailyRates("CDI", "2025-01-01", "2025-01-03")).rejects.toMatchObject({ kind: "TIMEOUT" });

    const p = new BcbSgsProvider({ fetchImpl: fakeFetch(() => ({ status: 200, body: "[]" })).impl, limiter: limiter() });
    await expect(p.getDailyRates("CDI", "2025-01-05", "2025-01-01")).rejects.toBeInstanceOf(ProviderError);
  });

  it("ignora datas fora do intervalo pedido e duplicadas", () => {
    const rows = parseSgsResponse(
      '[{"data":"31/12/2024","valor":"0.04"},{"data":"02/01/2025","valor":"0.045513"},{"data":"02/01/2025","valor":"0.045513"}]',
      "2025-01-01",
      "2025-01-31",
    );
    expect(rows).toEqual([{ date: "2025-01-02", dailyRatePercent: "0.045513" }]);
  });
});
