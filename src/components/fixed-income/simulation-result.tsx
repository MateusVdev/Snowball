import { SeriesLineChart } from "@/components/charts/series-line-chart";
import { Stat } from "@/components/portfolio/page-header";
import { Money } from "@/components/portfolio/values";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isoToBr } from "@/domain/fixed-income/labels";
import type { SimulationResult } from "@/domain/fixed-income/simulation";
import { roundMoney } from "@/domain/money";
import type { FixedIncomeSimulationConfig } from "@/validation/fixed-income-simulation";

const pt = (v: string | null) => (v ?? "").replace(".", ",");

export function simulationRateLabel(c: FixedIncomeSimulationConfig) {
  return c.rateMode === "CDI_PERCENT"
    ? `${pt(c.cdiPercent)}% do CDI (CDI estimado ${pt(c.cdiAnnualPercent)}% a.a.)`
    : `${pt(c.annualRatePercent)}% a.a.`;
}

/** Aviso fixo do simulador. */
export function SimulationNotice() {
  return (
    <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground" data-testid="simulation-notice">
      Simulação hipotética: considera a taxa informada constante durante todo o prazo, rendimento só em dias úteis (feriados
      nacionais), IR regressivo e IOF por aporte. Não é garantia de rentabilidade; o CDI real varia.
    </p>
  );
}

const n = (v: { toFixed(d: number): string }) => Number(roundMoney(v.toString()).toFixed(2)); // só para desenhar

export function SimulationResultView({ config, result }: { config: FixedIncomeSimulationConfig; result: SimulationResult }) {
  const s = result.summary;
  const chart = result.rows.map((r) => ({ label: `Mês ${r.month}`, net: n(r.net), applied: n(r.totalApplied), gross: n(r.gross) }));
  return (
    <div className="grid gap-6" data-testid="simulation-result">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Resultado da simulação">
        <Stat label="Total aplicado" hint={`${config.months} mês(es)`}><Money value={s.totalApplied} /></Stat>
        <Stat label="Valor bruto final"><Money value={s.gross} /></Stat>
        <Stat label="IR estimado" hint={config.taxExempt ? "Isento" : "Regressivo, por aporte"}><Money value={s.incomeTax} /></Stat>
        <Stat label="Valor líquido final" hint="Se resgatasse tudo no fim do prazo"><Money value={s.net} /></Stat>
        <Stat label="Rendimento líquido"><Money value={s.netEarnings} signed /></Stat>
      </section>
      <SimulationNotice />
      <Card>
        <CardHeader>
          <CardTitle>Evolução mês a mês</CardTitle>
          <CardDescription>{simulationRateLabel(config)} · {config.taxExempt ? "isento de IR" : "com IR"} · início em {isoToBr(config.startDate)}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <SeriesLineChart
            data={chart}
            series={[{ key: "net", label: "Valor líquido" }, { key: "applied", label: "Total aplicado" }, { key: "gross", label: "Valor bruto" }]}
            format="brl"
            ariaLabel="Evolução do valor líquido, bruto e do total aplicado"
            height={280}
          />
          <div className="max-h-[32rem] overflow-auto rounded-lg border">
            <Table data-testid="simulation-table">
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Aporte</TableHead>
                  <TableHead className="text-right">Total aplicado</TableHead>
                  <TableHead className="text-right">Rendimento do mês</TableHead>
                  <TableHead className="text-right">Rendimento acumulado</TableHead>
                  <TableHead className="text-right">IR estimado</TableHead>
                  <TableHead className="text-right">Valor líquido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((r) => (
                  <TableRow key={r.month} data-testid={`fi-sim-month-${r.month}`}>
                    <TableCell className="whitespace-nowrap">{r.month}<span className="ml-2 text-xs text-muted-foreground">{isoToBr(r.date)}</span></TableCell>
                    <TableCell className="text-right"><Money value={r.contribution} /></TableCell>
                    <TableCell className="text-right"><Money value={r.totalApplied} /></TableCell>
                    <TableCell className="text-right"><Money value={r.earnings} /></TableCell>
                    <TableCell className="text-right"><Money value={r.accumulatedEarnings} /></TableCell>
                    <TableCell className="text-right"><Money value={r.incomeTax.plus(r.iof)} /></TableCell>
                    <TableCell className="text-right"><Money value={r.net} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            “IR estimado” inclui o IOF quando há aporte com menos de 30 dias. Valor líquido = valor bruto − IR − IOF, como se resgatasse tudo no fim do mês.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
