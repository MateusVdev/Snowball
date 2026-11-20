import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ActionForm } from "@/components/forms/action-form";
import { MonthlyIncomeChart } from "@/components/charts/monthly-income-chart";
import { DividendEventsTable } from "@/components/dividends/events-table";
import { DataSourceBadge } from "@/components/dividends/badges";
import { PageHeader, Stat } from "@/components/portfolio/page-header";
import { CalendarDate, Money, Percent, Quantity, UnitPrice } from "@/components/portfolio/values";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL } from "@/domain/money";
import { confirmPendingAction, importDividendsAction } from "@/server/actions/market";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import { getDividendsOverview } from "@/server/services/dividends/dividend-service";
import { getPortfolio } from "@/server/services/portfolio/fund-service";

export const metadata: Metadata = { title: "Proventos" };

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

export default async function DividendsPage({ searchParams }: PageProps<"/proventos">) {
  const user = await requireUser();
  const params = await searchParams;
  const fundFilter = typeof params.fundo === "string" ? params.fundo.toUpperCase() : "";
  const db = getDb();
  const integrations = getIntegrations();
  const portfolio = await getPortfolio(db, user.id, { staleAfterBusinessHours: integrations.staleAfterBusinessHours });
  const prices = new Map(
    portfolio.positions.map((p) => [
      p.fundId,
      { price: p.metrics.currentPrice?.toFixed() ?? null, averagePrice: p.metrics.averagePrice?.toFixed() ?? null },
    ]),
  );
  const o = await getDividendsOverview(db, user.id, { prices });
  const events = fundFilter ? o.events.filter((e) => e.ticker === fundFilter) : o.events;
  const chartData = o.income.monthly.slice(-24).map((m) => ({
    month: m.month,
    label: monthLabel(m.month),
    total: m.total.toNumber(), // apenas para desenhar
    formatted: formatBRL(m.total),
  }));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Proventos"
        description="Rendimentos e amortizações: anunciados, pagos, previstos e recebidos."
        actions={
          <Button asChild>
            <Link href="/proventos/novo"><Plus aria-hidden /> Registrar provento</Link>
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo de renda">
        <Stat label="Total recebido" hint="Rendimentos registrados (sem amortizações)"><Money value={o.income.totalReceived} /></Stat>
        <Stat label="Últimos 12 meses"><Money value={o.income.last12Months} /></Stat>
        <Stat label="Renda passiva mensal" hint="Média dos últimos 12 meses (÷ 12)"><Money value={o.income.monthlyAverage12m} /></Stat>
        <Stat
          label="Média mensal"
          hint={o.income.monthly.length ? `Desde o 1º recebimento (${o.income.monthly.length} mês(es))` : "Sem recebimentos"}
        >
          <Money value={o.income.monthlyAverageSinceFirst} />
        </Stat>
        <Stat label="Recebido neste mês"><Money value={o.income.currentMonth} /></Stat>
        <Stat label="Recebido no mês anterior"><Money value={o.income.previousMonth} /></Stat>
        <Stat label="Amortizações recebidas" hint="Devolução de capital; fora da renda"><Money value={o.income.amortizationTotal} /></Stat>
      </section>

      {integrations.enabled ? (
        <ActionForm action={importDividendsAction} submitLabel="Importar proventos agora" submitVariant="outline" testId="import-dividends-form" className="max-w-3xl">
          <p className="text-sm text-muted-foreground">
            Busca proventos oficiais na brapi e, para fundos com CNPJ cadastrado, nos documentos da B3 FundosNET.
            Duplicidades são ignoradas e divergências entre fontes são apenas reportadas — nada é sobrescrito.
          </p>
        </ActionForm>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Próximos pagamentos</CardTitle>
          <CardDescription>
            Somente anúncios oficiais. Previsões aparecem separadas e nunca como anúncio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fundo</TableHead>
                <TableHead>Anúncio oficial</TableHead>
                <TableHead>Previsão (sua estimativa)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.upcoming.map((u) => (
                <TableRow key={u.fundId} data-testid={`upcoming-${u.ticker}`}>
                  <TableCell className="font-medium align-top">{u.ticker}</TableCell>
                  <TableCell className="align-top whitespace-normal">
                    {u.announced.length === 0 ? (
                      <span className="text-muted-foreground">Aguardando divulgação.</span>
                    ) : (
                      <ul className="grid gap-1">
                        {u.announced.map((e) => (
                          <li key={e.id} className="flex flex-wrap items-center gap-2">
                            <UnitPrice value={e.ratePerShare} /> por cota · data-com <CalendarDate value={e.dataCom} /> · pagamento{" "}
                            <CalendarDate value={e.paymentDate} empty="a definir" />
                            {e.expectedAmount ? <> · <strong><Money value={e.expectedAmount} /></strong> para <Quantity value={e.eligibility.status === "KNOWN" ? e.eligibility.quantity : null} /> cota(s)</> : null}
                            <DataSourceBadge source={e.source} verified={e.verified} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    {u.forecasts.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      u.forecasts.map((e) => (
                        <div key={e.id}>
                          ≈ <UnitPrice value={e.ratePerShare} /> por cota{e.paymentDate ? <> em <CalendarDate value={e.paymentDate} /></> : null} (estimativa)
                        </div>
                      ))
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {o.pending.length > 0 ? (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle>Pagos pelo fundo, sem recebimento registrado ({o.pending.length})</CardTitle>
            <CardDescription>
              Confirme para marcar como “recebido e registrado”. A quantidade vem do seu histórico na data-com; quando ele não
              permite saber (ex.: saldo inicial registrado depois da data-com), confirme individualmente informando a quantidade.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <details open={o.pending.length <= 5}>
              <summary className="cursor-pointer text-sm">Ver {o.pending.length} provento(s) pendente(s)</summary>
              <DividendEventsTable events={o.pending} />
            </details>
            <ActionForm action={confirmPendingAction} submitLabel="Registrar todos com quantidade conhecida" submitVariant="secondary" testId="confirm-pending-form">
              <span className="sr-only">Confirmar pendentes</span>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Renda mensal recebida</CardTitle>
            <CardDescription>Rendimentos registrados por mês de pagamento (últimos 24 meses).</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyIncomeChart data={chartData} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Por mês e por ano</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Table>
              <TableHeader><TableRow><TableHead>Ano</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {o.income.yearly.map((y) => (
                  <TableRow key={y.year}><TableCell>{y.year}</TableCell><TableCell className="text-right"><Money value={y.total} /></TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
            <details>
              <summary className="cursor-pointer text-sm">Tabela mensal ({o.income.monthly.length} meses)</summary>
              <Table>
                <TableBody>
                  {[...o.income.monthly].reverse().map((m) => (
                    <TableRow key={m.month}><TableCell>{monthLabel(m.month)}</TableCell><TableCell className="text-right"><Money value={m.total} /></TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Por fundo</CardTitle>
          <CardDescription>
            DY 12m = rendimentos por cota pagos nos últimos 12 meses ÷ cotação atual (exige histórico de 12 meses registrado).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fundo</TableHead>
                <TableHead className="text-right">Recebido (total)</TableHead>
                <TableHead className="text-right">Recebido 12m</TableHead>
                <TableHead className="text-right">Σ por cota 12m</TableHead>
                <TableHead className="text-right">Último/cota</TableHead>
                <TableHead className="text-right">DY 12m</TableHead>
                <TableHead className="text-right">Yield on cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.yields.map((y) => {
                const received = o.income.byFund.find((f) => f.fundId === y.fundId);
                return (
                  <TableRow key={y.fundId} data-testid={`yield-${y.ticker}`}>
                    <TableCell className="font-medium">{y.ticker}</TableCell>
                    <TableCell className="text-right"><Money value={received?.total ?? "0"} /></TableCell>
                    <TableCell className="text-right"><Money value={received?.last12Months ?? "0"} /></TableCell>
                    <TableCell className="text-right"><UnitPrice value={y.result.sumPerShare12m} /></TableCell>
                    <TableCell className="text-right"><UnitPrice value={y.result.lastRatePerShare} /></TableCell>
                    <TableCell className="text-right" title={y.result.insufficientReason ?? undefined}><Percent value={y.result.dividendYield12m} /></TableCell>
                    <TableCell className="text-right"><Percent value={y.result.yieldOnCost12m} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de proventos {fundFilter ? `— ${fundFilter}` : ""}</CardTitle>
          <CardDescription>
            <span className="flex flex-wrap gap-2">
              <Link className="underline" href="/proventos">Todos</Link>
              {portfolio.positions.map((p) => (
                <Link key={p.fundId} className="underline" href={`/proventos?fundo=${p.ticker}`}>{p.ticker}</Link>
              ))}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DividendEventsTable events={events} />
        </CardContent>
      </Card>
    </div>
  );
}
