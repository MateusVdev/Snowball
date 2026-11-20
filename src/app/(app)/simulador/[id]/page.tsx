import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";
import { SeriesLineChart } from "@/components/charts/series-line-chart";
import { ActionForm, CheckboxField } from "@/components/forms/action-form";
import { PageHeader, Stat } from "@/components/portfolio/page-header";
import { Money, Timestamp, UnitPrice } from "@/components/portfolio/values";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { GrowthRule, MonthResult, SimulationConfig } from "@/domain/simulation";
import { deleteSimulationAction, duplicateSimulationAction, restoreVersionAction } from "@/server/actions/simulation";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getSimulation, listSimulationVersions } from "@/server/services/simulation/simulation-service";

export const metadata: Metadata = { title: "Simulação" };

const n = (v: string) => Number(v); // apenas para desenhar gráficos

function growthText(g: GrowthRule) {
  if (g.mode === "CONSTANT") return "constante";
  return `${g.ratePercent.replace(".", ",")}% ${g.mode === "MONTHLY" ? "ao mês" : "ao ano"}`;
}

function allocationText(c: SimulationConfig) {
  const a = c.allocation;
  const ticker = (k: string) => c.funds.find((f) => f.key === k)?.ticker ?? k;
  if (a.mode === "SAME_FUND") {
    const w = Object.entries(a.contributionWeights);
    return `Dividendos reinvestidos no próprio fundo; aportes ${w.length ? w.map(([k, v]) => `${ticker(k)} ${v}%`).join(", ") : "em partes iguais"}.`;
  }
  if (a.mode === "WEIGHTS") return `Dividendos e aportes por percentual: ${Object.entries(a.weights).map(([k, v]) => `${ticker(k)} ${v}%`).join(", ")}.`;
  return `Caixa comum com ${a.purchases.length} compra(s) planejada(s) manualmente.`;
}

function MonthlyTable({ rows, fundKey }: { rows: MonthResult[]; fundKey: string | null }) {
  return (
    <div className="max-h-[32rem] overflow-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            <TableHead>Mês</TableHead>
            <TableHead className="text-right">Cotas iniciais</TableHead>
            <TableHead className="text-right">Cotas elegíveis</TableHead>
            <TableHead className="text-right">Dividendos</TableHead>
            <TableHead className="text-right">Não reinvestido</TableHead>
            <TableHead className="text-right">Aportes</TableHead>
            <TableHead className="text-right">Dinheiro acumulado</TableHead>
            <TableHead className="text-right">Cotas compradas</TableHead>
            <TableHead className="text-right">Cotas finais</TableHead>
            <TableHead className="text-right">Saldo restante</TableHead>
            <TableHead className="text-right">Renda mensal</TableHead>
            <TableHead className="text-right">{fundKey ? "Valor da posição" : "Patrimônio"}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const f = fundKey ? r.funds.find((x) => x.key === fundKey) : null;
            const v = f
              ? { start: f.startShares, elig: f.eligibleShares, div: f.dividendsReceived, notR: f.notReinvested, contrib: f.contributions, cash: f.cashAvailable, bought: f.sharesBought, end: f.endShares, rem: f.cashRemaining, income: f.dividendsReceived, total: f.positionValue }
              : { start: r.startShares, elig: r.eligibleShares, div: r.dividendsReceived, notR: r.notReinvested, contrib: (n(r.regularContribution) + n(r.extraContribution)).toFixed(2), cash: r.cashAvailable, bought: r.sharesBought, end: r.endShares, rem: r.cashRemaining, income: r.monthlyIncome, total: r.patrimony };
            return (
              <TableRow key={r.month} data-testid={`sim-month-${r.month}`}>
                <TableCell>{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{v.start}</TableCell>
                <TableCell className="text-right tabular-nums">{v.elig}</TableCell>
                <TableCell className="text-right"><Money value={v.div} /></TableCell>
                <TableCell className="text-right"><Money value={v.notR} /></TableCell>
                <TableCell className="text-right"><Money value={v.contrib} /></TableCell>
                <TableCell className="text-right"><Money value={v.cash} /></TableCell>
                <TableCell className="text-right tabular-nums">{v.bought}</TableCell>
                <TableCell className="text-right tabular-nums">{v.end}</TableCell>
                <TableCell className="text-right"><Money value={v.rem} /></TableCell>
                <TableCell className="text-right"><Money value={v.income} /></TableCell>
                <TableCell className="text-right"><Money value={v.total} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function SimulationPage({ params, searchParams }: PageProps<"/simulador/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const sim = await getSimulation(db, user.id, id);
  if (!sim) notFound();
  const versions = await listSimulationVersions(db, user.id, id);
  const { config, result, scenarios } = sim;
  const s = result.summary;
  const fundKey = typeof sp.fundo === "string" && config.funds.some((f) => f.key === sp.fundo) ? sp.fundo : null;
  const shortLabel = (r: MonthResult) => (config.startMonth ? r.label.replace(/^Mês \d+ \((.*)\)$/, "$1") : String(r.month));

  const data = result.months.map((r) => ({
    label: shortLabel(r),
    shares: n(r.endShares),
    income: n(r.monthlyIncome),
    patrimony: n(r.patrimony),
    dividends: n(r.dividendsReceived),
    contributions: n(r.regularContribution) + n(r.extraContribution),
    cash: n(r.cashRemaining),
  }));
  const scenarioData = result.months.map((r, i) => ({
    label: shortLabel(r),
    ...Object.fromEntries(scenarios.map((sc) => [sc.scenario.key, n(sc.result.months[i].patrimony)])),
  }));
  const scenarioIncome = result.months.map((r, i) => ({
    label: shortLabel(r),
    ...Object.fromEntries(scenarios.map((sc) => [sc.scenario.key, n(sc.result.months[i].monthlyIncome)])),
  }));
  const scenarioSeries = scenarios.map((sc) => ({ key: sc.scenario.key, label: sc.scenario.label }));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={sim.name}
        description={sim.description ?? (sim.origin === "PORTFOLIO" ? "Cópia da carteira real (não sincronizada)." : "Simulação independente.")}
        actions={
          <>
            <Button asChild><Link href={`/simulador/${sim.id}/editar`}>Editar premissas</Link></Button>
            <ActionForm action={duplicateSimulationAction.bind(null, sim.id)} submitLabel="Duplicar" submitVariant="outline" className="gap-0">
              <span className="sr-only">Duplicar simulação</span>
            </ActionForm>
          </>
        }
      />

      <Alert>
        <AlertDescription>
          <strong>Simulação hipotética.</strong> Resultados decorrem exclusivamente das premissas abaixo; dividendos não são garantidos e
          preços variam. Esta simulação não altera a sua carteira real. Motor v{result.engineVersion}, cálculo determinístico.
        </AlertDescription>
      </Alert>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo">
        <Stat label="Cotas" hint={`${s.initialShares} → ${s.finalShares} (+${s.sharesBought})`}>{s.finalShares}</Stat>
        <Stat label="Renda mensal final" hint={<>Próximo mês: <Money value={s.projectedNextMonthIncome} /></>}><Money value={s.finalMonthlyIncome} /></Stat>
        <Stat label="Patrimônio final" hint={<>Inicial: <Money value={s.initialPatrimony} /></>}><Money value={s.finalPatrimony} /></Stat>
        <Stat label="Dividendos recebidos" hint={<>Reinvestidos: <Money value={s.totalReinvested} /></>}><Money value={s.totalDividendsReceived} /></Stat>
        <Stat label="Aportes totais" hint="Inclui saldo inicial"><Money value={s.totalContributions} /></Stat>
        <Stat label="Não reinvestido (à parte)" hint="Fora do patrimônio simulado"><Money value={s.totalNotReinvested} /></Stat>
        <Stat label="Saldo em caixa final" hint="Troco acumulado, nunca descartado"><Money value={s.finalCash} /></Stat>
        {config.timing === "CALENDAR" ? (
          <Stat label="A receber após o prazo" hint="Data-com no prazo, pagamento depois"><Money value={s.dividendsPendingAfterHorizon} /></Stat>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Premissas</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>Prazo: {config.months} meses · Modelo: {config.timing === "MONTHLY" ? "mensal simplificado (cotas novas rendem a partir do mês seguinte)" : `calendário (compras no dia ${config.purchaseDay})`}</p>
            <p>Aporte mensal: <Money value={config.monthlyContribution} /> · Saldo inicial: <Money value={config.initialCash} /> · Aportes extraordinários: {config.extraContributions.length}</p>
            <p>{allocationText(config)} Somente cotas inteiras; o troco fica em caixa.</p>
            <ul className="grid gap-1">
              {config.funds.map((f) => (
                <li key={f.key} className="rounded border px-2 py-1">
                  <strong>{f.ticker}</strong>: {f.initialQuantity} cotas · preço <UnitPrice value={f.price} /> ({growthText(f.priceGrowth)}) · dividendo{" "}
                  <UnitPrice value={f.monthlyDividend} />/mês ({growthText(f.dividendGrowth)}) · reinvestimento {f.reinvestmentPercent}%
                  {config.timing === "CALENDAR" ? ` · data-com dia ${f.calendar.dataComDay}, pagamento dia ${f.calendar.paymentDay} (+${f.calendar.paymentLagMonths} mês)` : ""}
                  {f.priceChanges.length + f.dividendChanges.length ? ` · ${f.priceChanges.length + f.dividendChanges.length} alteração(ões) pontual(is)` : ""}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Marcos</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm" data-testid="milestones">
              {result.milestones.map((m) => (
                <li key={m.key} className="flex items-start gap-2">
                  {m.month ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 text-emerald-700" /> : <Circle aria-hidden className="mt-0.5 size-4 text-muted-foreground" />}
                  <span>
                    {m.label}:{" "}
                    {m.month ? <strong>{result.months[m.month - 1].label}</strong> : <span className="text-muted-foreground">{m.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Evolução das cotas</CardTitle></CardHeader><CardContent><SeriesLineChart data={data} series={[{ key: "shares", label: "Cotas" }]} format="int" ariaLabel="Cotas ao fim de cada mês" /></CardContent></Card>
        <Card><CardHeader><CardTitle>Renda passiva mensal</CardTitle></CardHeader><CardContent><SeriesLineChart data={data} series={[{ key: "income", label: "Renda mensal" }]} format="brl" ariaLabel="Dividendos recebidos por mês" /></CardContent></Card>
        <Card><CardHeader><CardTitle>Evolução patrimonial</CardTitle></CardHeader><CardContent><SeriesLineChart data={data} series={[{ key: "patrimony", label: "Patrimônio" }]} format="brl" ariaLabel="Patrimônio ao fim de cada mês" /></CardContent></Card>
        <Card><CardHeader><CardTitle>Dividendos × aportes</CardTitle></CardHeader><CardContent><SeriesLineChart data={data} series={[{ key: "dividends", label: "Dividendos recebidos" }, { key: "contributions", label: "Aportes" }]} format="brl" ariaLabel="Dividendos e aportes por mês" /></CardContent></Card>
        <Card><CardHeader><CardTitle>Saldo acumulado em caixa</CardTitle><CardDescription>Troco que espera para a próxima compra.</CardDescription></CardHeader><CardContent><SeriesLineChart data={data} series={[{ key: "cash", label: "Saldo" }]} format="brl" ariaLabel="Saldo em caixa ao fim de cada mês" /></CardContent></Card>
        <Card>
          <CardHeader>
            <CardTitle>Comparação dos cenários (patrimônio)</CardTitle>
            <CardDescription>Cenários hipotéticos; ver tabela abaixo.</CardDescription>
          </CardHeader>
          <CardContent><SeriesLineChart data={scenarioData} series={scenarioSeries} format="brl" ariaLabel="Patrimônio por cenário" /></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cenários hipotéticos</CardTitle>
          <CardDescription>
            Cada cenário aplica a todos os fundos as taxas anuais indicadas (substituindo as variações configuradas). A coluna “Premissas
            configuradas” usa exatamente as suas premissas. Taxas anuais passam a valer no mês 13 (e a cada 12 meses): em prazos de até 12
            meses, os cenários coincidem com a referência.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cenário</TableHead>
                <TableHead className="text-right">Preço a.a.</TableHead>
                <TableHead className="text-right">Dividendo a.a.</TableHead>
                <TableHead className="text-right">Cotas finais</TableHead>
                <TableHead className="text-right">Renda mensal final</TableHead>
                <TableHead className="text-right">Patrimônio final</TableHead>
                <TableHead className="text-right">Dividendos recebidos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="font-medium">
                <TableCell>Premissas configuradas</TableCell>
                <TableCell className="text-right">—</TableCell>
                <TableCell className="text-right">—</TableCell>
                <TableCell className="text-right tabular-nums">{s.finalShares}</TableCell>
                <TableCell className="text-right"><Money value={s.finalMonthlyIncome} /></TableCell>
                <TableCell className="text-right"><Money value={s.finalPatrimony} /></TableCell>
                <TableCell className="text-right"><Money value={s.totalDividendsReceived} /></TableCell>
              </TableRow>
              {scenarios.map((sc) => (
                <TableRow key={sc.scenario.key} data-testid={`scenario-${sc.scenario.key}`}>
                  <TableCell>{sc.scenario.label}</TableCell>
                  <TableCell className="text-right">{sc.scenario.priceAnnualPercent.replace(".", ",")}%</TableCell>
                  <TableCell className="text-right">{sc.scenario.dividendAnnualPercent.replace(".", ",")}%</TableCell>
                  <TableCell className="text-right tabular-nums">{sc.result.summary.finalShares}</TableCell>
                  <TableCell className="text-right"><Money value={sc.result.summary.finalMonthlyIncome} /></TableCell>
                  <TableCell className="text-right"><Money value={sc.result.summary.finalPatrimony} /></TableCell>
                  <TableCell className="text-right"><Money value={sc.result.summary.totalDividendsReceived} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <SeriesLineChart data={scenarioIncome} series={scenarioSeries} format="brl" ariaLabel="Renda mensal por cenário" height={200} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tabela mensal {fundKey ? `— ${config.funds.find((f) => f.key === fundKey)?.ticker}` : "(todos os fundos)"}</CardTitle>
          <CardDescription>
            <span className="flex flex-wrap gap-3">
              <Link className={fundKey ? "underline" : "font-medium"} href={`/simulador/${sim.id}`}>Consolidado</Link>
              {config.funds.map((f) => (
                <Link key={f.key} className={fundKey === f.key ? "font-medium" : "underline"} href={`/simulador/${sim.id}?fundo=${f.key}`}>{f.ticker}</Link>
              ))}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlyTable rows={result.months} fundKey={fundKey} />
          {config.allocation.mode === "MANUAL" && fundKey ? (
            <p className="mt-2 text-xs text-muted-foreground">Na escolha manual o caixa é comum; por fundo aparecem as compras e os dividendos.</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Histórico de versões</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {versions.map((v, i) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
                  <span>v{v.version} · {v.note} · <Timestamp value={v.createdAt} /></span>
                  {i > 0 ? (
                    <ActionForm action={restoreVersionAction.bind(null, sim.id, v.id)} submitLabel="Restaurar" submitVariant="outline" className="gap-0">
                      <span className="sr-only">Restaurar versão {v.version}</span>
                    </ActionForm>
                  ) : <span className="text-muted-foreground">atual</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Excluir simulação</CardTitle>
            <CardDescription>Remove a simulação e suas versões. A carteira real não é afetada.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={deleteSimulationAction.bind(null, sim.id)} submitLabel="Excluir" submitVariant="destructive" testId="delete-simulation-form">
              <CheckboxField name="confirm" label="Confirmo a exclusão desta simulação" />
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
