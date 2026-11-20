import type { Metadata } from "next";
import Link from "next/link";
import { AllocationBars } from "@/components/overview/allocation-bars";
import { PageHeader, Stat } from "@/components/portfolio/page-header";
import { Money, Percent, UnitPrice } from "@/components/portfolio/values";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FinDecimal } from "@/domain/money";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import { getOverview } from "@/server/services/overview/overview-service";

export const metadata: Metadata = { title: "Análise da carteira" };

export default async function AnalysisPage() {
  const user = await requireUser();
  const o = await getOverview(getDb(), user.id, { staleAfterBusinessHours: getIntegrations().staleAfterBusinessHours });
  const active = o.portfolio.positions.filter((p) => !p.archivedAt && p.metrics.quantity.gt(0));
  const weight = new Map(o.byFund.map((s) => [s.key, s.share]));
  const yields = new Map(o.dividends.yields.map((y) => [y.fundId, y.result]));
  const recurring = new Map(o.recurringIncome.byFund.map((r) => [r.fundId, r.amount]));
  const top = o.byFund[0];
  const winners = active.filter((p) => p.metrics.unrealizedResult?.gt(0)).length;
  const losers = active.filter((p) => p.metrics.unrealizedResult?.lt(0)).length;

  return (
    <div className="grid gap-6">
      <PageHeader title="Análise da carteira" description="Composição, concentração, resultados e renda por fundo — a partir dos seus registros." />
      {active.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          Sem posições abertas. <Link className="underline" href="/carteira/novo">Adicionar FII</Link>
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Fundos com posição">{active.length}</Stat>
            <Stat label="Maior posição" hint={top ? top.label : undefined} info="Participação do maior fundo no valor da carteira.">{top ? <Percent value={top.share} /> : "—"}</Stat>
            <Stat label="Fundos no positivo / negativo">{winners} / {losers}</Stat>
            <Stat label="Renda recorrente estimada" info="Cotas atuais × último rendimento oficial pago."><Money value={o.recurringIncome.total} /></Stat>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Distribuição por fundo</CardTitle></CardHeader>
              <CardContent><AllocationBars slices={o.byFund} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Distribuição por segmento</CardTitle><CardDescription>Segmento informado no cadastro do fundo.</CardDescription></CardHeader>
              <CardContent><AllocationBars slices={o.bySegment} /></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Resultados e renda por fundo</CardTitle>
              <CardDescription>DY e yield on cost de 12 meses exigem 12 meses de proventos oficiais registrados.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fundo</TableHead>
                    <TableHead className="text-right">Peso</TableHead>
                    <TableHead className="text-right">Investido</TableHead>
                    <TableHead className="text-right">Valor atual</TableHead>
                    <TableHead className="text-right">Não realizado</TableHead>
                    <TableHead className="text-right">Rentab.</TableHead>
                    <TableHead className="text-right">Realizado</TableHead>
                    <TableHead className="text-right">Últ. rend./cota</TableHead>
                    <TableHead className="text-right">Renda/mês est.</TableHead>
                    <TableHead className="text-right">DY 12m</TableHead>
                    <TableHead className="text-right">YoC 12m</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.map((p) => {
                    const y = yields.get(p.fundId);
                    return (
                      <TableRow key={p.fundId}>
                        <TableCell className="font-medium"><Link className="hover:underline" href={`/carteira/${p.ticker}`}>{p.ticker}</Link></TableCell>
                        <TableCell className="text-right"><Percent value={weight.get(p.fundId) ?? new FinDecimal(0)} /></TableCell>
                        <TableCell className="text-right"><Money value={p.metrics.investedCapital} /></TableCell>
                        <TableCell className="text-right"><Money value={p.metrics.currentValue} /></TableCell>
                        <TableCell className="text-right"><Money value={p.metrics.unrealizedResult} signed /></TableCell>
                        <TableCell className="text-right"><Percent value={p.metrics.unrealizedReturn} /></TableCell>
                        <TableCell className="text-right"><Money value={p.metrics.realizedResult} signed /></TableCell>
                        <TableCell className="text-right"><UnitPrice value={y?.lastRatePerShare ?? null} /></TableCell>
                        <TableCell className="text-right"><Money value={recurring.get(p.fundId) ?? null} /></TableCell>
                        <TableCell className="text-right" title={y?.insufficientReason ?? undefined}><Percent value={y?.dividendYield12m ?? null} /></TableCell>
                        <TableCell className="text-right"><Percent value={y?.yieldOnCost12m ?? null} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
