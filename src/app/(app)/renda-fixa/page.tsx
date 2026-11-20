import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ActionForm } from "@/components/forms/action-form";
import { EstimateNotice } from "@/components/fixed-income/estimate-notice";
import { YieldEstimateCard } from "@/components/fixed-income/yield-estimate";
import { PageHeader, Stat } from "@/components/portfolio/page-header";
import { Money } from "@/components/portfolio/values";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PRODUCT_TYPE_LABEL, rateLabel } from "@/domain/fixed-income/labels";
import { refreshIndexRatesAction } from "@/server/actions/fixed-income";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import { listFixedIncomeAssets } from "@/server/services/fixed-income/fixed-income-service";
import { ensureIndexRates } from "@/server/services/fixed-income/refresh";

export const metadata: Metadata = { title: "Renda fixa" };

export default async function FixedIncomePage({ searchParams }: PageProps<"/renda-fixa">) {
  const user = await requireUser();
  const params = await searchParams;
  const showArchived = params.arquivados === "1";
  const db = getDb();
  const integrations = getIntegrations();
  await ensureIndexRates(db, integrations.indexRates, user.id, { budgetMs: 8000 });
  const { assets, totals, ratesKnownUntil, hasProjection, yieldEstimate } = await listFixedIncomeAssets(db, user.id, { includeArchived: showArchived });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Renda fixa"
        description="CDBs, caixinhas, LCI/LCA e Tesouro Selic, com valor estimado pelo CDI/Selic."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/renda-fixa/simulador">Simular com aportes</Link>
            </Button>
            <Button asChild>
              <Link href="/renda-fixa/novo"><Plus aria-hidden /> Adicionar título</Link>
            </Button>
          </>
        }
      />

      <EstimateNotice ratesKnownUntil={assets.length ? ratesKnownUntil : undefined} projected={hasProjection} />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo da renda fixa">
        <Stat label="Valor aplicado" hint="Ainda investido (aportes menos o que já foi resgatado)"><Money value={totals.principal} /></Stat>
        <Stat label="Valor bruto" hint="Estimado, antes de IR e IOF"><Money value={totals.gross} /></Stat>
        <Stat label="Valor líquido" hint="Se resgatasse tudo hoje (após IR e IOF estimados)"><Money value={totals.net} /></Stat>
        <Stat label="Rendimento do mês" hint="Bruto, estimado"><Money value={totals.monthEarnings} signed /></Stat>
      </section>

      {assets.some((a) => !a.archivedAt) ? <YieldEstimateCard estimate={yieldEstimate} title="Quanto a renda fixa rende (estimativa, total)" /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <form className="flex items-center gap-3" action="/renda-fixa">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="arquivados" value="1" defaultChecked={showArchived} />
            Mostrar arquivados
          </label>
          <Button type="submit" variant="secondary" size="sm">Filtrar</Button>
        </form>
        {integrations.enabled ? (
          <ActionForm action={refreshIndexRatesAction} submitLabel="Atualizar índices do Banco Central" submitVariant="outline" testId="refresh-index-form">
            <span className="sr-only">Buscar CDI e Selic mais recentes</span>
          </ActionForm>
        ) : null}
      </div>

      {assets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          Nenhum título cadastrado ainda. <Link className="underline" href="/renda-fixa/novo">Adicione o primeiro</Link>.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table data-testid="fixed-income-table">
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Emissor</TableHead>
                <TableHead>Rentabilidade</TableHead>
                <TableHead className="text-right">Aplicado</TableHead>
                <TableHead className="text-right">Bruto</TableHead>
                <TableHead className="text-right">Líquido</TableHead>
                <TableHead className="text-right">Rendimento do mês</TableHead>
                <TableHead className="text-right">Por dia útil (estim.)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link className="font-medium underline-offset-4 hover:underline" href={`/renda-fixa/${a.id}`}>{a.name}</Link>
                    <div className="flex flex-wrap gap-1 pt-1">
                      <Badge variant="outline">{PRODUCT_TYPE_LABEL[a.productType] ?? a.productType}</Badge>
                      {a.taxExempt ? <Badge variant="secondary">Isento de IR</Badge> : null}
                      {a.archivedAt ? <Badge variant="outline">Arquivado</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>{a.issuer ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="whitespace-nowrap">{rateLabel(a.rate, a.indexer, a.spreadAnnualPercent)}</TableCell>
                  <TableCell className="text-right"><Money value={a.result.current.principal} /></TableCell>
                  <TableCell className="text-right"><Money value={a.result.current.gross} /></TableCell>
                  <TableCell className="text-right"><Money value={a.result.current.net} /></TableCell>
                  <TableCell className="text-right"><Money value={a.result.monthEarnings} signed /></TableCell>
                  <TableCell className="text-right">{a.yieldEstimate.available ? <Money value={a.yieldEstimate.perBusinessDay.gross} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
