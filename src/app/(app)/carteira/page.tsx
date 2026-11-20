import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Stat } from "@/components/portfolio/page-header";
import {
  Money,
  Percent,
  Quantity,
  QuoteSourceBadge,
  UnitPrice,
} from "@/components/portfolio/values";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getPortfolio } from "@/server/services/portfolio/fund-service";

export const metadata: Metadata = { title: "Carteira" };

export default async function PortfolioPage({ searchParams }: PageProps<"/carteira">) {
  const user = await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 12) : "";
  const showArchived = params.arquivados === "1";
  const { positions, totals } = await getPortfolio(getDb(), user.id, {
    query: q,
    includeArchived: showArchived,
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Carteira"
        description="Posições calculadas a partir do histórico de operações."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/operacoes/nova">Registrar operação</Link>
            </Button>
            <Button asChild>
              <Link href="/carteira/novo">
                <Plus aria-hidden /> Adicionar FII
              </Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo da carteira">
        <Stat label="Capital investido">
          <Money value={totals.investedCapital} />
        </Stat>
        <Stat
          label="Valor atual"
          hint={
            totals.positionsWithoutQuote > 0
              ? `${totals.positionsWithoutQuote} posição(ões) sem cotação não incluída(s)`
              : "Com base nas cotações manuais registradas"
          }
        >
          <Money value={totals.currentValue} />
        </Stat>
        <Stat label="Resultado não realizado" hint={<Percent value={totals.unrealizedReturn} />}>
          <Money value={totals.unrealizedResult} signed />
        </Stat>
        <Stat label="Resultado realizado" hint="Soma das vendas registradas">
          <Money value={totals.realizedResult} signed />
        </Stat>
      </section>

      <form className="flex flex-wrap items-center gap-3" role="search" action="/carteira">
        <div className="relative w-full max-w-xs">
          <Search aria-hidden className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Pesquisar ticker"
            aria-label="Pesquisar por ticker"
            className="pl-8"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="arquivados" value="1" defaultChecked={showArchived} />
          Mostrar arquivados
        </label>
        <Button type="submit" variant="secondary" size="sm">
          Filtrar
        </Button>
      </form>

      {positions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {q ? `Nenhum fundo encontrado para "${q}".` : "Nenhum fundo cadastrado ainda."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Nome / segmento</TableHead>
                <TableHead className="text-right">Cotas</TableHead>
                <TableHead className="text-right">Preço médio</TableHead>
                <TableHead className="text-right">Investido</TableHead>
                <TableHead className="text-right">Cotação</TableHead>
                <TableHead className="text-right">Valor atual</TableHead>
                <TableHead className="text-right">Resultado</TableHead>
                <TableHead className="text-right">Rentab.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((p) => (
                <TableRow key={p.fundId} data-testid={`position-${p.ticker}`}>
                  <TableCell className="font-medium">
                    <Link href={`/carteira/${p.ticker}`} className="underline-offset-4 hover:underline">
                      {p.ticker}
                    </Link>
                    {p.archivedAt ? (
                      <Badge variant="secondary" className="ml-2">
                        Arquivado
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-56 truncate">
                    <div>{p.name ?? <span className="text-muted-foreground">Nome não informado</span>}</div>
                    <div className="text-xs text-muted-foreground">{p.segment ?? "Segmento não informado"}</div>
                  </TableCell>
                  <TableCell className="text-right"><Quantity value={p.metrics.quantity} /></TableCell>
                  <TableCell className="text-right"><UnitPrice value={p.metrics.averagePrice} /></TableCell>
                  <TableCell className="text-right"><Money value={p.metrics.investedCapital} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <UnitPrice value={p.metrics.currentPrice} />
                      {p.quote ? (
                        <QuoteSourceBadge recordedAt={p.quote.recordedAt} referenceDate={p.quote.referenceDate} />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right"><Money value={p.metrics.currentValue} /></TableCell>
                  <TableCell className="text-right"><Money value={p.metrics.unrealizedResult} signed /></TableCell>
                  <TableCell className="text-right"><Percent value={p.metrics.unrealizedReturn} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Resultado e rentabilidade referem-se às cotas em carteira (não realizado). Cotações marcadas como
        “Manual” são valores de referência digitados, não cotações de mercado em tempo real.
      </p>
    </div>
  );
}
