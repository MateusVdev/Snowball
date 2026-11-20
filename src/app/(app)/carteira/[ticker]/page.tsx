import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pencil } from "lucide-react";
import { ActionForm, Field } from "@/components/forms/action-form";
import { PageHeader, Stat } from "@/components/portfolio/page-header";
import { OperationsTable } from "@/components/portfolio/operations-table";
import {
  CalendarDate,
  Money,
  Percent,
  Quantity,
  QuoteSourceBadge,
  Timestamp,
  UnitPrice,
} from "@/components/portfolio/values";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addQuoteAction } from "@/server/actions/portfolio";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getFundByTicker, listQuotes } from "@/server/services/portfolio/fund-service";
import { listFundOperations } from "@/server/services/portfolio/operation-service";
import { getIntegrations } from "@/server/integrations/registry";
import { listDailyPrices } from "@/server/services/market/quote-service";
import { listDividendEvents } from "@/server/services/dividends/dividend-service";
import { dividendYield12m } from "@/domain/dividends";
import { todayIsoDate } from "@/domain/dates";
import { formatBRL, toDecimal } from "@/domain/money";
import { formatDate } from "@/domain/dates";
import { PriceHistoryChart } from "@/components/charts/price-history-chart";
import { DividendEventsTable } from "@/components/dividends/events-table";
import { refreshPriceHistoryAction, refreshQuotesAction } from "@/server/actions/market";

export async function generateMetadata({ params }: PageProps<"/carteira/[ticker]">): Promise<Metadata> {
  const { ticker } = await params;
  return { title: decodeURIComponent(ticker).toUpperCase() };
}

export default async function FundPage({ params }: PageProps<"/carteira/[ticker]">) {
  const user = await requireUser();
  const { ticker } = await params;
  const db = getDb();
  const integrations = getIntegrations();
  const stale = { staleAfterBusinessHours: integrations.staleAfterBusinessHours };
  const fund = await getFundByTicker(db, user.id, decodeURIComponent(ticker), stale);
  if (!fund) notFound();
  // URL canônica em maiúsculas (ex.: /carteira/mxrf11 → /carteira/MXRF11).
  if (fund.ticker !== ticker) redirect(`/carteira/${fund.ticker}`);

  const todayIso = todayIsoDate();
  const [operations, quotes, prices, events] = await Promise.all([
    listFundOperations(db, user.id, fund.fundId),
    listQuotes(db, user.id, fund.fundId, stale),
    listDailyPrices(db, user.id, fund.fundId),
    listDividendEvents(db, user.id, { fundId: fund.fundId, todayIso }),
  ]);
  const dy = dividendYield12m(
    events,
    fund.metrics.currentPrice?.toFixed() ?? null,
    fund.metrics.averagePrice?.toFixed() ?? null,
    todayIso,
  );
  const lastPaid = events
    .filter((e) => e.kind === "OFFICIAL" && e.type === "INCOME" && e.status === "PAID")
    .sort((a, b) => b.dataCom.getTime() - a.dataCom.getTime())[0] ?? null;
  const nextAnnounced = events
    .filter((e) => e.status === "ANNOUNCED")
    .sort((a, b) => (a.paymentDate?.getTime() ?? Infinity) - (b.paymentDate?.getTime() ?? Infinity))[0] ?? null;
  const pricePoints = prices.map((p) => ({
    label: formatDate(p.date).slice(0, 5),
    close: toDecimal(p.close).toNumber(), // apenas para posicionar no gráfico
    formatted: formatBRL(p.close),
  }));
  const m = fund.metrics;
  const hasActiveInitial = operations.some((o) => o.type === "INITIAL_BALANCE" && o.status === "ACTIVE");
  const archived = Boolean(fund.archivedAt);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {fund.ticker}
            {archived ? <Badge variant="secondary">Arquivado</Badge> : null}
          </span>
        }
        description={
          <>
            {fund.name ?? "Nome não informado"} · {fund.segment ?? "Segmento não informado"} ·{" "}
            {fund.cnpj ? `CNPJ ${fund.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}` : "CNPJ não informado"}
            {integrations.enabled ? (
              <>
                {" · "}
                <Link className="underline" href={`/carteira/${fund.ticker}/dados-externos`}>Consultar dados cadastrais</Link>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/carteira/${fund.ticker}/editar`}>
                <Pencil aria-hidden /> Editar / remover
              </Link>
            </Button>
            {!archived ? (
              <>
                <Button asChild variant="secondary">
                  <Link href={`/operacoes/nova?fundo=${fund.ticker}&tipo=SELL`}>Registrar venda</Link>
                </Button>
                <Button asChild>
                  <Link href={`/operacoes/nova?fundo=${fund.ticker}&tipo=BUY`}>Registrar compra</Link>
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Posição">
        <Stat label="Quantidade de cotas"><Quantity value={m.quantity} /></Stat>
        <Stat label="Preço médio"><UnitPrice value={m.averagePrice} /></Stat>
        <Stat label="Capital investido" hint="Custo das cotas em carteira, com taxas">
          <Money value={m.investedCapital} />
        </Stat>
        <Stat
          label="Cotação atual"
          hint={
            fund.quote ? (
              <span className="flex flex-wrap items-center gap-1">
                <QuoteSourceBadge quote={fund.quote} />
                {fund.quote.changePercent ? (
                  <>dia <Percent value={toDecimal(fund.quote.changePercent).dividedBy(100)} />{" "}</>
                ) : null}
                {fund.quote.source !== "MANUAL" ? (
                  <>de <Timestamp value={fund.quote.asOf} /></>
                ) : fund.quote.referenceDate ? (
                  <>ref. <CalendarDate value={fund.quote.referenceDate} /></>
                ) : (
                  <>registrada em <Timestamp value={fund.quote.recordedAt} /></>
                )}
              </span>
            ) : (
              "Sem cotação registrada"
            )
          }
        >
          <UnitPrice value={m.currentPrice} />
        </Stat>
        <Stat label="Valor atual"><Money value={m.currentValue} /></Stat>
        <Stat label="Resultado não realizado"><Money value={m.unrealizedResult} signed /></Stat>
        <Stat label="Rentabilidade" hint="Não realizado ÷ capital investido"><Percent value={m.unrealizedReturn} /></Stat>
        <Stat label="Resultado realizado" hint="Vendas registradas"><Money value={m.realizedResult} signed /></Stat>
        <Stat label="Último rendimento" hint={lastPaid ? <>pago em <CalendarDate value={lastPaid.paymentDate} /> · {lastPaid.competence ?? lastPaid.referenceLabel ?? ""}</> : "Nenhum rendimento oficial registrado"}>
          <UnitPrice value={lastPaid?.ratePerShare ?? null} />
        </Stat>
        <Stat label="Próximo provento anunciado" hint={nextAnnounced ? <>pagamento <CalendarDate value={nextAnnounced.paymentDate} empty="a definir" />{nextAnnounced.expectedAmount ? <> · esperado <Money value={nextAnnounced.expectedAmount} /></> : null}</> : undefined}>
          {nextAnnounced ? <UnitPrice value={nextAnnounced.ratePerShare} /> : <span className="text-base font-normal text-muted-foreground">Aguardando divulgação.</span>}
        </Stat>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Proventos do fundo</CardTitle>
            <CardDescription>
              DY 12m:{" "}
              {dy.dividendYield12m ? <Percent value={dy.dividendYield12m} /> : <span>indisponível ({dy.insufficientReason})</span>}
              {" · "}Yield on cost 12m: {dy.yieldOnCost12m ? <Percent value={dy.yieldOnCost12m} /> : "indisponível"}
              {" · "}Σ 12m por cota: <UnitPrice value={dy.sumPerShare12m} /> ({dy.eventsCount} pagamento(s))
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DividendEventsTable events={events.slice(0, 8)} showFund={false} />
            <p className="mt-2 text-sm">
              <Link className="underline" href={`/proventos?fundo=${fund.ticker}`}>Ver todos os proventos</Link>
              {" · "}
              <Link className="underline" href={`/proventos/novo?fundo=${fund.ticker}`}>Registrar provento</Link>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Fechamentos diários</CardTitle>
            <CardDescription>
              Histórico da brapi (disponível conforme o plano; sem chave, só fundos de teste). {prices.length} dia(s) registrados.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <PriceHistoryChart data={pricePoints} />
            {integrations.enabled && !archived ? (
              <div className="flex flex-wrap gap-4">
                <ActionForm action={refreshQuotesAction} submitLabel="Atualizar cotação" submitVariant="outline" testId="refresh-quote-form">
                  <span className="sr-only">Atualizar cotações</span>
                </ActionForm>
                <ActionForm action={refreshPriceHistoryAction} submitLabel="Importar histórico (90 dias)" submitVariant="outline">
                  <span className="sr-only">Importar histórico</span>
                </ActionForm>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de operações</CardTitle>
          <CardDescription>
            Inclui operações canceladas e corrigidas (que não entram no cálculo).{" "}
            <Link className="underline" href={`/operacoes?fundo=${fund.ticker}&status=all`}>
              Ver no histórico geral
            </Link>
            {!hasActiveInitial && !archived ? (
              <>
                {" · "}
                <Link className="underline" href={`/carteira/${fund.ticker}/saldo-inicial`}>
                  Registrar saldo inicial
                </Link>
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OperationsTable operations={operations} showFund={false} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Atualizar cotação manual</CardTitle>
            <CardDescription>
              Valor de referência digitado por você. O histórico de cotações é mantido.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={addQuoteAction.bind(null, fund.fundId, fund.ticker)}
              submitLabel="Salvar cotação"
              submitVariant="secondary"
              testId="quote-form"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="price" label="Cotação (R$)" inputMode="decimal" />
                <Field name="referenceDate" label="Data de referência (opcional)" type="date" />
              </div>
              <Field name="note" label="Observação (opcional)" />
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cotações registradas</CardTitle>
          </CardHeader>
          <CardContent>
            {quotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma cotação registrada.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {quotes.slice(0, 10).map((q) => (
                  <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
                    <span className="flex items-center gap-2">
                      <UnitPrice value={q.price} />
                      <QuoteSourceBadge quote={q} />
                    </span>
                    <span className="text-muted-foreground">
                      {q.source !== "MANUAL" ? <>mercado <Timestamp value={q.asOf} /> · </> : null}
                      {q.referenceDate ? <>ref. <CalendarDate value={q.referenceDate} /> · </> : null}
                      registrada em <Timestamp value={q.recordedAt} />
                      {q.note ? ` · ${q.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {fund.notes ? (
        <Card>
          <CardHeader><CardTitle>Observações</CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{fund.notes}</CardContent>
        </Card>
      ) : null}
    </div>
  );
}
