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

export async function generateMetadata({ params }: PageProps<"/carteira/[ticker]">): Promise<Metadata> {
  const { ticker } = await params;
  return { title: decodeURIComponent(ticker).toUpperCase() };
}

export default async function FundPage({ params }: PageProps<"/carteira/[ticker]">) {
  const user = await requireUser();
  const { ticker } = await params;
  const db = getDb();
  const fund = await getFundByTicker(db, user.id, decodeURIComponent(ticker));
  if (!fund) notFound();
  // URL canônica em maiúsculas (ex.: /carteira/mxrf11 → /carteira/MXRF11).
  if (fund.ticker !== ticker) redirect(`/carteira/${fund.ticker}`);

  const [operations, quotes] = await Promise.all([
    listFundOperations(db, user.id, fund.fundId),
    listQuotes(db, user.id, fund.fundId),
  ]);
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
            {fund.name ?? "Nome não informado"} · {fund.segment ?? "Segmento não informado"}
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
                <QuoteSourceBadge recordedAt={fund.quote.recordedAt} referenceDate={fund.quote.referenceDate} />
                {fund.quote.referenceDate ? (
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
      </section>

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
                      <QuoteSourceBadge recordedAt={q.recordedAt} referenceDate={q.referenceDate} />
                    </span>
                    <span className="text-muted-foreground">
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
