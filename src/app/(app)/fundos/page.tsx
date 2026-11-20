import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { DataSourceBadge } from "@/components/dividends/badges";
import { PageHeader } from "@/components/portfolio/page-header";
import { CalendarDate, Money, Percent, Quantity, QuoteSourceBadge, UnitPrice } from "@/components/portfolio/values";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toDecimal } from "@/domain/money";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import { getOverview } from "@/server/services/overview/overview-service";

export const metadata: Metadata = { title: "Análise individual dos FIIs" };

export default async function FundsIndexPage({ searchParams }: PageProps<"/fundos">) {
  const user = await requireUser();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim().toUpperCase().slice(0, 12) : "";
  const o = await getOverview(getDb(), user.id, { staleAfterBusinessHours: getIntegrations().staleAfterBusinessHours });
  const funds = o.portfolio.positions.filter((p) => !p.archivedAt && (!query || p.ticker.includes(query)));
  const yields = new Map(o.dividends.yields.map((y) => [y.fundId, y.result]));

  return (
    <div className="grid gap-6">
      <PageHeader title="Análise individual dos FIIs" description="Escolha um fundo para ver cotação, histórico de preços, proventos e resultado." />
      <form action="/fundos" role="search" className="flex max-w-md gap-2">
        <div className="relative flex-1">
          <Search aria-hidden className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input name="q" defaultValue={query} placeholder="Pesquisar ticker" aria-label="Pesquisar por ticker" className="pl-8" />
        </div>
        <Button type="submit" variant="secondary">Buscar</Button>
      </form>
      {funds.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          {query ? `Nenhum fundo encontrado para "${query}".` : "Nenhum fundo cadastrado."}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {funds.map((p) => {
            const next = o.dividends.upcoming.find((u) => u.fundId === p.fundId)?.announced[0] ?? null;
            const y = yields.get(p.fundId);
            return (
              <Link key={p.fundId} href={`/carteira/${p.ticker}`} className="group rounded-xl focus-visible:outline-2" data-testid={`fund-card-${p.ticker}`}>
                <Card className="h-full transition-transform group-hover:-translate-y-0.5">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      <span className="text-lg">{p.ticker}</span>
                      {p.quote ? <QuoteSourceBadge quote={p.quote} /> : null}
                    </CardTitle>
                    <p className="truncate text-sm text-muted-foreground">{p.name ?? "Nome não informado"} · {p.segment ?? "Segmento não informado"}</p>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <span className="text-muted-foreground">Cotação</span>
                    <span className="text-right">
                      <UnitPrice value={p.metrics.currentPrice} />{" "}
                      {p.quote?.changePercent ? <Percent value={toDecimal(p.quote.changePercent).dividedBy(100)} /> : null}
                    </span>
                    <span className="text-muted-foreground">Cotas</span><span className="text-right"><Quantity value={p.metrics.quantity} /></span>
                    <span className="text-muted-foreground">Resultado</span><span className="text-right"><Money value={p.metrics.unrealizedResult} signed /></span>
                    <span className="text-muted-foreground">Rentabilidade</span><span className="text-right"><Percent value={p.metrics.unrealizedReturn} /></span>
                    <span className="text-muted-foreground">DY 12m</span><span className="text-right"><Percent value={y?.dividendYield12m ?? null} /></span>
                    <span className="text-muted-foreground">Próximo provento</span>
                    <span className="text-right">
                      {next ? (
                        <span className="inline-flex items-center gap-1"><UnitPrice value={next.ratePerShare} /> · <CalendarDate value={next.paymentDate} empty="a definir" /></span>
                      ) : (
                        <span className="text-muted-foreground">Aguardando divulgação.</span>
                      )}
                    </span>
                    {next ? <span className="col-span-2 text-right"><DataSourceBadge source={next.source} verified={next.verified} /></span> : null}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
