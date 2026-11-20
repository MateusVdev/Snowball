import type { Metadata } from "next";
import Link from "next/link";
import { SeriesLineChart } from "@/components/charts/series-line-chart";
import { PageHeader, Stat } from "@/components/portfolio/page-header";
import { Money } from "@/components/portfolio/values";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPercent, roundMoney } from "@/domain/money";
import { monthLabel } from "@/domain/simulation";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { ServiceError } from "@/server/services/errors";
import { listFixedIncomeSimulations } from "@/server/services/fixed-income/simulation-service";
import { buildPatrimonyProjection, type PatrimonyProjectionView } from "@/server/services/patrimony/patrimony-projection-service";
import { listSimulations } from "@/server/services/simulation/simulation-service";

export const metadata: Metadata = { title: "Simulação do patrimônio total" };

const n = (v: { toString(): string }) => Number(roundMoney(v.toString()).toFixed(2)); // só para desenhar

export default async function PatrimonySimulationPage({ searchParams }: PageProps<"/simulador/patrimonio">) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const fiiId = typeof sp.fii === "string" ? sp.fii : "";
  const rfId = typeof sp.rf === "string" ? sp.rf : "";
  const [fiiSims, rfSims] = await Promise.all([listSimulations(db, user.id), listFixedIncomeSimulations(db, user.id)]);

  let view: PatrimonyProjectionView | null = null;
  let error: string | null = null;
  if (fiiId || rfId) {
    try {
      view = await buildPatrimonyProjection(db, user.id, { fiiSimulationId: fiiId || null, fixedIncomeSimulationId: rfId || null });
    } catch (e) {
      if (e instanceof ServiceError) error = e.message;
      else throw e;
    }
  }
  const p = view?.projection;
  const last = p?.months.at(-1);
  const hasFii = p?.classes.some((c) => c.key === "FII") ?? false;
  const hasRf = p?.classes.some((c) => c.key === "FIXED_INCOME") ?? false;
  const label = (m: number) => monthLabel(view?.fii?.startMonth ?? null, m);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Simulação do patrimônio total"
        description="Junta uma simulação de FIIs (bola de neve) e uma de renda fixa num resultado único mês a mês, dividido por classe de ativo."
        actions={
          <>
            <Button asChild variant="outline"><Link href="/simulador">Simulador de FIIs</Link></Button>
            <Button asChild variant="outline"><Link href="/renda-fixa/simulador">Simulador de renda fixa</Link></Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Simulações</CardTitle>
          <CardDescription>Escolha simulações salvas (ao menos uma). Ambas contam a partir do mês 1.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" action="/simulador/patrimonio" className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" data-testid="patrimony-form">
            <div className="grid gap-2">
              <Label htmlFor="pat-fii">FIIs (simulador bola de neve)</Label>
              <NativeSelect id="pat-fii" name="fii" defaultValue={fiiId}>
                <option value="">Nenhuma</option>
                {fiiSims.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pat-rf">Renda fixa (simulador de renda fixa)</Label>
              <NativeSelect id="pat-rf" name="rf" defaultValue={rfId}>
                <option value="">Nenhuma</option>
                {rfSims.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </div>
            <Button type="submit">Simular patrimônio</Button>
          </form>
          {fiiSims.length + rfSims.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhuma simulação salva. Crie uma no <Link className="underline" href="/simulador">simulador de FIIs</Link> ou no{" "}
              <Link className="underline" href="/renda-fixa/simulador">simulador de renda fixa</Link>.
            </p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
        </CardContent>
      </Card>

      {p && last ? (
        <div className="grid gap-6" data-testid="patrimony-result">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resultado final">
            <Stat label="Patrimônio total final" hint={label(last.month)}><Money value={last.total} /></Stat>
            {last.classes.map((c) => (
              <Stat key={c.key} label={c.label} hint={c.share ? `${formatPercent(c.share)} do total` : undefined}>
                {c.value ? <Money value={c.value} /> : "—"}
              </Stat>
            ))}
            {hasRf ? <Stat label="Total com renda fixa líquida" hint="Renda fixa após IR/IOF estimados"><Money value={view!.netTotals.at(-1)!} /></Stat> : null}
          </section>
          <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground" data-testid="patrimony-notice">
            Simulação hipotética, a partir das premissas de cada simulação ({p.classes.map((c) => `${c.label}: “${c.source}”`).join(" · ")}). FIIs pelo
            patrimônio simulado; renda fixa pelo valor bruto (mesma base do patrimônio do dashboard).
            {p.truncated ? ` Os prazos são diferentes: o resultado vai até o mês ${p.months.length}, o prazo da simulação mais curta.` : ""}
          </p>
          <Card>
            <CardHeader><CardTitle>Evolução mês a mês</CardTitle></CardHeader>
            <CardContent className="grid gap-6">
              <SeriesLineChart
                data={p.months.map((m) => ({ label: `Mês ${m.month}`, total: n(m.total), ...(hasFii ? { fii: n(m.byClass.FII!) } : {}), ...(hasRf ? { rf: n(m.byClass.FIXED_INCOME!) } : {}) }))}
                series={[{ key: "total", label: "Patrimônio total" }, ...(hasFii ? [{ key: "fii", label: "FIIs" }] : []), ...(hasRf ? [{ key: "rf", label: "Renda fixa" }] : [])]}
                format="brl"
                ariaLabel="Evolução do patrimônio total por classe de ativo"
                height={280}
              />
              <div className="max-h-[32rem] overflow-auto rounded-lg border">
                <Table data-testid="patrimony-table">
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Mês</TableHead>
                      {p.classes.map((c) => <TableHead key={c.key} className="text-right">{c.label}</TableHead>)}
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Divisão</TableHead>
                      {hasRf ? <TableHead className="text-right">Total (renda fixa líquida)</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.months.map((m, i) => (
                      <TableRow key={m.month} data-testid={`patrimony-month-${m.month}`}>
                        <TableCell className="whitespace-nowrap">{label(m.month)}</TableCell>
                        {p.classes.map((c) => <TableCell key={c.key} className="text-right"><Money value={m.byClass[c.key] ?? null} /></TableCell>)}
                        <TableCell className="text-right font-medium"><Money value={m.total} /></TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {m.classes.map((c) => `${c.label} ${c.share ? formatPercent(c.share) : "—"}`).join(" · ")}
                        </TableCell>
                        {hasRf ? <TableCell className="text-right"><Money value={view!.netTotals[i]} /></TableCell> : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
