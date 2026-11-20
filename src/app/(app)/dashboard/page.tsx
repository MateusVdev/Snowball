import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { MonthlyIncomeChart } from "@/components/charts/monthly-income-chart";
import { SeriesLineChart } from "@/components/charts/series-line-chart";
import { AllocationBars } from "@/components/overview/allocation-bars";
import { GoalProgressBar } from "@/components/overview/goal-progress";
import { PageHeader, Stat } from "@/components/portfolio/page-header";
import { Money, Percent, Quantity } from "@/components/portfolio/values";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/domain/dates";
import { formatBRL, toDecimal } from "@/domain/money";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import { listGoalStatuses } from "@/server/services/goals/goal-service";
import { getOverview } from "@/server/services/overview/overview-service";
import { ensureIndexRates } from "@/server/services/fixed-income/refresh";
import { formatPercent } from "@/domain/money";

export const metadata: Metadata = { title: "Visão geral" };

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

export default async function DashboardPage() {
  const user = await requireUser();
  const db = getDb();
  const integrations = getIntegrations();
  await ensureIndexRates(db, integrations.indexRates, user.id, { budgetMs: 5000 });
  const o = await getOverview(db, user.id, { staleAfterBusinessHours: integrations.staleAfterBusinessHours });
  const goals = await listGoalStatuses(db, user.id, o);
  const t = o.portfolio.totals;
  const hasPositions = o.portfolio.positions.some((p) => !p.archivedAt) || o.fixedIncome.assets.length > 0;
  const patrimony = o.patrimony;
  const totalResult = t.unrealizedResult.plus(t.realizedResult);

  const historyData = o.history.map((h) => ({
    label: monthLabel(h.month),
    invested: h.investedCapital ? h.investedCapital.toNumber() : null,
    value: h.marketValue ? h.marketValue.toNumber() : null,
  }));
  const incompleteMonths = o.history.filter((h) => h.marketValue === null).length;
  const dividendsData = o.dividends.income.monthly.slice(-12).map((m) => ({ month: m.month, label: monthLabel(m.month), total: m.total.toNumber(), formatted: formatBRL(m.total) }));
  const flowsData = o.flows.slice(-12).map((f) => ({ month: f.month, label: monthLabel(f.month), total: f.net.toNumber(), formatted: formatBRL(f.net) }));

  if (!hasPositions) {
    return (
      <div className="grid gap-6">
        <PageHeader title={`Olá, ${user.name}`} description="Comece cadastrando seus fundos." />
        <Card>
          <CardContent className="grid justify-items-start gap-4 py-4">
            <p className="text-muted-foreground">Sua carteira está vazia. Cadastre um FII (com saldo inicial, se já tiver cotas), registre uma compra ou adicione um título de renda fixa.</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild><Link href="/carteira/novo"><Plus aria-hidden /> Adicionar FII</Link></Button>
              <Button asChild variant="outline"><Link href="/renda-fixa/novo">Adicionar renda fixa</Link></Button>
              <Button asChild variant="outline"><Link href="/simulador/nova?origem=exemplo">Explorar o simulador</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Olá, ${user.name}`}
        description={`Visão geral em ${formatDate(new Date(`${o.todayIso}T00:00:00Z`))} · valores calculados a partir dos seus registros`}
        actions={<Button asChild variant="outline"><Link href="/carteira">Minha carteira <ArrowRight aria-hidden /></Link></Button>}
      />

      <section className="grid gap-4 lg:grid-cols-3" aria-label="Patrimônio">
        <Card className="accent-ring lg:col-span-1">
          <CardContent className="grid gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Patrimônio total</span>
            <span className="text-3xl font-semibold tracking-tight" data-testid="overview-patrimony">
              {patrimony.total ? <Money value={patrimony.total} /> : <span title="Há fundos sem cotação">—</span>}
            </span>
            <span className="text-sm text-muted-foreground">
              {patrimony.total ? "FIIs pela cotação atual + renda fixa pelo valor bruto estimado." : `${t.positionsWithoutQuote} fundo(s) sem cotação: total indisponível.`}
            </span>
            <ul className="mt-2 grid gap-2" aria-label="Patrimônio por classe de ativo" data-testid="patrimony-by-class">
              {patrimony.classes.map((c, i) => (
                <li key={c.key} className="grid gap-1" data-testid={`patrimony-class-${c.key}`}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    {c.href ? <Link className="font-medium underline-offset-4 hover:underline" href={c.href}>{c.label}</Link> : <span className="font-medium">{c.label}</span>}
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {c.share ? `${formatPercent(c.share)} · ` : ""}
                      {c.value ? <Money value={c.value} /> : "sem cotação"}
                    </span>
                  </div>
                  {c.share ? (
                    <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(1, c.share.times(100).toNumber())}%`, background: `var(--series-${(i % 4) + 1})` }} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {o.fixedIncome.assets.length ? (
              <span className="text-xs text-muted-foreground">
                Renda fixa: estimativa pelo CDI/Selic do Banco Central (líquido estimado <Money value={o.fixedIncome.totals.net} />).
              </span>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>Resultado FIIs: <Money value={t.unrealizedResult} signed /></span>
              <span>Rentabilidade FIIs: <Percent value={t.unrealizedReturn} /></span>
            </div>
          </CardContent>
        </Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-3">
          <Stat label="Capital investido" info="Custo das cotas em carteira, incluindo taxas de compra (preço médio × quantidade)."><Money value={t.investedCapital} /></Stat>
          <Stat label="Lucro / prejuízo" hint={<>Realizado <Money value={t.realizedResult} signed /></>} info="Não realizado (valor atual − investido) + resultado realizado nas vendas."><Money value={totalResult} signed /></Stat>
          <Stat label="Quantidade de cotas"><Quantity value={o.totalShares} /></Stat>
          <Stat label="Dividendos do mês" info="Recebimentos registrados com pagamento neste mês."><Money value={o.dividends.income.currentMonth} /></Stat>
          <Stat label="Dividendos do ano"><Money value={o.dividendsThisYear} /></Stat>
          <Stat label="Dividendos acumulados"><Money value={o.dividends.income.totalReceived} /></Stat>
          <Stat label="Média mensal (12 m)" info="Rendimentos recebidos nos últimos 12 meses ÷ 12."><Money value={o.dividends.income.monthlyAverage12m} /></Stat>
          <Stat
            label="Renda passiva recorrente"
            info="Estimativa: cotas atuais × último rendimento oficial pago de cada fundo. Não é garantia."
            hint={o.recurringIncome.fundsWithoutHistory ? `${o.recurringIncome.fundsWithoutHistory} fundo(s) sem rendimento registrado` : "por mês, estimada"}
          >
            <Money value={o.recurringIncome.total} />
          </Stat>
          <Stat label="Rentabilidade" info="Resultado não realizado ÷ capital investido (posições com cotação)."><Percent value={t.unrealizedReturn} /></Stat>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Evolução patrimonial</CardTitle>
            <CardDescription>
              Capital investido × valor de mercado ao fim de cada mês, reconstruídos das operações e cotações registradas.
              {incompleteMonths ? ` ${incompleteMonths} mês(es) sem valor de mercado (posição ou cotação desconhecida) — não estimados.` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SeriesLineChart data={historyData} series={[{ key: "value", label: "Valor de mercado" }, { key: "invested", label: "Capital investido" }]} format="brl" ariaLabel="Evolução patrimonial mensal" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Metas</CardTitle>
            <CardDescription><Link className="underline" href="/metas">Gerenciar metas</Link></CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {goals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma meta. <Link className="underline" href="/metas">Criar uma meta</Link>.</p>
            ) : (
              goals.slice(0, 4).map((g) => <GoalProgressBar key={g.id} goal={g} />)
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Dividendos recebidos</CardTitle><CardDescription>Últimos 12 meses com registro.</CardDescription></CardHeader>
          <CardContent><MonthlyIncomeChart data={dividendsData} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Aportes por mês</CardTitle>
            <CardDescription>Compras (com taxas) − vendas. Saldos iniciais sem data (<Money value={o.initialBalancesCost} />) não entram.</CardDescription>
          </CardHeader>
          <CardContent>{flowsData.length ? <MonthlyIncomeChart data={flowsData} /> : <p className="text-sm text-muted-foreground">Nenhuma compra ou venda registrada.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Distribuição da carteira</CardTitle><CardDescription>Por fundo (valor de mercado; sem cotação, custo).</CardDescription></CardHeader>
          <CardContent className="grid gap-6">
            <AllocationBars slices={o.byFund} />
            <details>
              <summary className="cursor-pointer text-sm">Por segmento</summary>
              <div className="mt-3"><AllocationBars slices={o.bySegment} /></div>
            </details>
          </CardContent>
        </Card>
      </div>

      {o.dividends.pending.length ? (
        <Card className="border-primary/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm">{o.dividends.pending.length} provento(s) pago(s) pelo fundo sem recebimento registrado.</span>
            <Button asChild size="sm" variant="outline"><Link href="/proventos">Revisar</Link></Button>
          </CardContent>
        </Card>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Valor de mercado usa a cotação mais recente de cada fundo ({toDecimal(t.positionsWithoutQuote).isZero() ? "todas disponíveis" : "algumas indisponíveis"}). Rentabilidade não inclui proventos.
      </p>
    </div>
  );
}
