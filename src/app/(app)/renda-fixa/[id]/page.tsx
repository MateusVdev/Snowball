import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { SeriesLineChart } from "@/components/charts/series-line-chart";
import { ActionForm, CheckboxField, Field, FormNote } from "@/components/forms/action-form";
import { EstimateNotice } from "@/components/fixed-income/estimate-notice";
import { PageHeader, Stat } from "@/components/portfolio/page-header";
import { Money } from "@/components/portfolio/values";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayIsoDate } from "@/domain/dates";
import { PRODUCT_TYPE_LABEL, isoToBr, monthLabel, rateLabel } from "@/domain/fixed-income/labels";
import { roundMoney } from "@/domain/money";
import {
  addFixedIncomeMovementAction,
  deleteFixedIncomeMovementAction,
  updateFixedIncomeMovementAction,
} from "@/server/actions/fixed-income";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import { ServiceError } from "@/server/services/errors";
import { getFixedIncomeAsset } from "@/server/services/fixed-income/fixed-income-service";
import { ensureIndexRates } from "@/server/services/fixed-income/refresh";

export const metadata: Metadata = { title: "Título de renda fixa" };

const TYPE_OPTIONS = [
  { value: "DEPOSIT", label: "Aporte" },
  { value: "WITHDRAWAL", label: "Resgate (valor líquido recebido)" },
];

async function load(userId: string, id: string) {
  try {
    return await getFixedIncomeAsset(getDb(), userId, id);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export default async function FixedIncomeDetailPage({ params }: PageProps<"/renda-fixa/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  await ensureIndexRates(getDb(), getIntegrations().indexRates, user.id, { budgetMs: 8000 });
  const asset = await load(user.id, id);
  const r = asset.result;
  const today = todayIsoDate();
  const withdrawals = new Map(r.withdrawals.map((w) => [w.movementId, w]));
  const movements = [...asset.movements].reverse(); // mais recentes primeiro
  const months = [...r.months].reverse();
  const chart = r.months.map((m) => ({
    label: monthLabel(m.month),
    gross: Number(roundMoney(m.end.gross).toFixed(2)),
    principal: Number(roundMoney(m.end.principal).toFixed(2)),
  }));
  const details = [
    PRODUCT_TYPE_LABEL[asset.productType] ?? asset.productType,
    asset.issuer,
    rateLabel(asset.rate, asset.indexer, asset.spreadAnnualPercent),
    asset.taxExempt ? "isento de IR" : "com IR",
    asset.dailyLiquidity ? "liquidez diária" : null,
    asset.maturityDate ? `vence em ${isoToBr(asset.maturityDate)}` : null,
  ].filter(Boolean);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{asset.name}{asset.archivedAt ? <Badge variant="outline">Arquivado</Badge> : null}</span>}
        description={details.join(" · ")}
        actions={
          <>
            <Button asChild variant="outline"><Link href="/renda-fixa"><ArrowLeft aria-hidden /> Renda fixa</Link></Button>
            <Button asChild variant="outline"><Link href={`/renda-fixa/${asset.id}/editar`}><Pencil aria-hidden /> Editar título</Link></Button>
          </>
        }
      />

      <EstimateNotice ratesKnownUntil={r.ratesKnownUntil} projected={r.projectedBusinessDays > 0} />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Posição estimada">
        <Stat label="Valor aplicado" hint={<>Total aportado: <Money value={r.totalDeposited} /></>}><Money value={r.current.principal} /></Stat>
        <Stat label="Valor bruto"><Money value={r.current.gross} /></Stat>
        <Stat label="Valor líquido" hint="Se resgatasse tudo hoje"><Money value={r.current.net} /></Stat>
        <Stat label="IR estimado" hint={asset.taxExempt ? "Título isento" : "Tabela regressiva, por aporte"}><Money value={r.current.incomeTax} /></Stat>
        <Stat label="IOF estimado" hint="Só nos primeiros 29 dias de cada aporte"><Money value={r.current.iof} /></Stat>
        <Stat label="Rendimento" hint={<>No mês: <Money value={r.monthEarnings} signed /></>}><Money value={r.accumulatedEarnings} signed /></Stat>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Novo aporte ou resgate</CardTitle>
          <CardDescription>No resgate, informe o valor <strong>líquido</strong> que caiu na conta (o do extrato). O sistema calcula o valor bruto equivalente.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={addFixedIncomeMovementAction.bind(null, asset.id)} submitLabel="Registrar" testId="movement-form">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field name="type" label="Tipo" as="select" defaultValue="DEPOSIT" options={TYPE_OPTIONS} />
              <Field name="date" label="Data" type="date" defaultValue={today} max={today} />
              <Field name="amount" label="Valor (R$)" inputMode="decimal" placeholder="100,00" />
              <Field name="notes" label="Observação (opcional)" />
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aportes e resgates</CardTitle>
          <CardDescription>Resgates consomem primeiro os aportes mais antigos (estimativa; a regra do banco pode variar).</CardDescription>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum movimento registrado.</p>
          ) : (
            <Table data-testid="movements-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Bruto equivalente</TableHead>
                  <TableHead className="text-right">IR + IOF</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => {
                  const w = withdrawals.get(m.id);
                  return (
                    <TableRow key={m.id} className="align-top">
                      <TableCell className="tabular-nums">{isoToBr(m.date)}</TableCell>
                      <TableCell>
                        {m.type === "DEPOSIT" ? "Aporte" : "Resgate"}
                        {m.notes ? <div className="text-xs text-muted-foreground">{m.notes}</div> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={m.amount} />
                        {m.type === "WITHDRAWAL" ? <div className="text-xs text-muted-foreground">líquido</div> : null}
                      </TableCell>
                      <TableCell className="text-right">{w ? <Money value={w.gross} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right">{w ? <Money value={w.incomeTax.plus(w.iof)} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <details>
                          <summary className="cursor-pointer text-sm">Editar ou excluir</summary>
                          <div className="mt-3 grid min-w-64 gap-4">
                            <ActionForm action={updateFixedIncomeMovementAction.bind(null, m.id)} submitLabel="Salvar" submitVariant="secondary">
                              <div className="grid gap-3">
                                <Field name="type" label="Tipo" as="select" defaultValue={m.type} options={TYPE_OPTIONS} />
                                <Field name="date" label="Data" type="date" defaultValue={m.date} max={today} />
                                <Field name="amount" label="Valor (R$)" inputMode="decimal" defaultValue={m.amount} />
                                <Field name="notes" label="Observação" defaultValue={m.notes ?? ""} />
                              </div>
                            </ActionForm>
                            <ActionForm action={deleteFixedIncomeMovementAction.bind(null, m.id)} submitLabel="Excluir" submitVariant="destructive">
                              <CheckboxField name="confirm" label="Confirmo a exclusão deste movimento" />
                            </ActionForm>
                          </div>
                        </details>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evolução mês a mês</CardTitle>
          <CardDescription>Posição no fim de cada mês (no mês atual, até hoje). Valores estimados.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {r.months.length === 0 ? (
            <FormNote>Registre um aporte para ver a evolução.</FormNote>
          ) : (
            <>
              <SeriesLineChart
                data={chart}
                series={[{ key: "gross", label: "Valor bruto" }, { key: "principal", label: "Valor aplicado" }]}
                format="brl"
                ariaLabel="Gráfico da evolução mensal do valor bruto e do valor aplicado"
              />
              <Table data-testid="months-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Mês</TableHead>
                    <TableHead className="text-right">Aportes</TableHead>
                    <TableHead className="text-right">Resgates (líquido)</TableHead>
                    <TableHead className="text-right">Rendimento</TableHead>
                    <TableHead className="text-right">Bruto no fim</TableHead>
                    <TableHead className="text-right">Líquido no fim</TableHead>
                    <TableHead className="text-right">Acumulado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {months.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="whitespace-nowrap">
                        {monthLabel(m.month)}
                        {m.projected ? <Badge variant="outline" className="ml-2">projeção</Badge> : null}
                        {m.missingIndex ? <Badge variant="outline" className="ml-2">sem índice</Badge> : null}
                      </TableCell>
                      <TableCell className="text-right"><Money value={m.deposits} /></TableCell>
                      <TableCell className="text-right"><Money value={m.withdrawalsNet} /></TableCell>
                      <TableCell className="text-right"><Money value={m.earnings} signed /></TableCell>
                      <TableCell className="text-right"><Money value={m.end.gross} /></TableCell>
                      <TableCell className="text-right"><Money value={m.end.net} /></TableCell>
                      <TableCell className="text-right"><Money value={m.accumulatedEarnings} signed /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
