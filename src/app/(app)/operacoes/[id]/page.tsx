import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Field, FormNote } from "@/components/forms/action-form";
import { PageHeader } from "@/components/portfolio/page-header";
import { TradePreview } from "@/components/portfolio/trade-preview";
import {
  CalendarDate,
  Money,
  OperationStatusBadge,
  OperationTypeBadge,
  Quantity,
  Timestamp,
  UnitPrice,
  operationTypeLabel,
} from "@/components/portfolio/values";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toIsoDate, todayIsoDate } from "@/domain/dates";
import { cancelOperationAction, correctOperationAction } from "@/server/actions/portfolio";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getOperation, listOperationAudit } from "@/server/services/portfolio/operation-service";

export const metadata: Metadata = { title: "Operação" };

const ACTION_LABEL: Record<string, string> = {
  create: "Registrada",
  cancel: "Cancelada",
  correct: "Corrigida (substituída)",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default async function OperationPage({ params }: PageProps<"/operacoes/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const op = await getOperation(db, user.id, id);
  if (!op) notFound();
  const audit = await listOperationAudit(db, user.id, op.id);
  const isTrade = op.type !== "INITIAL_BALANCE";
  const active = op.status === "ACTIVE";
  const brl = (v: string) => v.replace(".", ",");

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {operationTypeLabel(op.type)} · {op.ticker}
            <OperationStatusBadge status={op.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap gap-3">
            <Link className="underline" href={`/carteira/${op.ticker}`}>Ver posição</Link>
            <Link className="underline" href={`/operacoes?fundo=${op.ticker}&status=all`}>Histórico do fundo</Link>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Dados da operação</CardTitle></CardHeader>
          <CardContent>
            <dl>
              <Row label="Tipo"><OperationTypeBadge type={op.type} /></Row>
              <Row label="Data"><CalendarDate value={op.tradeDate} empty="Não informada (saldo inicial)" /></Row>
              <Row label="Quantidade"><Quantity value={op.quantity} /></Row>
              <Row label={isTrade ? "Preço unitário" : "Preço médio informado"}><UnitPrice value={op.unitPrice} /></Row>
              <Row label="Valor bruto"><Money value={op.grossAmount} /></Row>
              <Row label="Taxas"><Money value={op.fees} /></Row>
              <Row label={op.type === "SELL" ? "Valor líquido recebido" : "Valor total"}><Money value={op.netAmount} /></Row>
              {op.notes ? <Row label="Observações">{op.notes}</Row> : null}
              <Row label="Registrada em"><Timestamp value={op.createdAt} /></Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Efeito na posição</CardTitle>
            <CardDescription>
              {active ? "Calculado pelo reprocessamento do histórico." : "Operação inativa: não entra no cálculo."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label="Cotas após"><Quantity value={op.quantityAfter} /></Row>
              <Row label="Preço médio após"><UnitPrice value={op.averagePriceAfter} /></Row>
              {op.type === "SELL" ? (
                <>
                  <Row label="Custo das cotas vendidas"><Money value={op.costOfSold} /></Row>
                  <Row label="Resultado realizado"><Money value={op.realizedResult} signed /></Row>
                </>
              ) : null}
            </dl>
            {op.correctsId ? (
              <FormNote>
                Esta operação corrige <Link className="underline" href={`/operacoes/${op.correctsId}`}>uma operação anterior</Link>.
              </FormNote>
            ) : null}
            {op.correctedById ? (
              <FormNote>
                Substituída pela <Link className="underline" href={`/operacoes/${op.correctedById}`}>versão corrigida</Link>.
              </FormNote>
            ) : null}
            {op.voidReason ? (
              <FormNote>
                Motivo: {op.voidReason}
                {op.voidedAt ? <> (<Timestamp value={op.voidedAt} />)</> : null}
              </FormNote>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {active ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Corrigir</CardTitle>
              <CardDescription>
                Cria uma nova versão e mantém esta no histórico como “Corrigida”. A posição é recalculada;
                se o histórico ficar inconsistente, nada é alterado.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={correctOperationAction.bind(null, op.id)} submitLabel="Salvar correção" testId="correct-form">
                {isTrade ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field name="tradeDate" label="Data" type="date" defaultValue={op.tradeDate ? toIsoDate(op.tradeDate) : ""} max={todayIsoDate()} />
                    <Field name="quantity" label="Quantidade" inputMode="numeric" defaultValue={op.quantity} />
                    <Field name="unitPrice" label="Preço unitário (R$)" inputMode="decimal" defaultValue={brl(op.unitPrice)} />
                    <Field name="fees" label="Taxas (R$)" inputMode="decimal" defaultValue={brl(op.fees)} />
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field name="quantity" label="Quantidade" inputMode="numeric" defaultValue={op.quantity} />
                    <Field name="averagePrice" label="Preço médio (R$)" inputMode="decimal" defaultValue={brl(op.unitPrice)} />
                  </div>
                )}
                <Field name="notes" label="Observações" as="textarea" defaultValue={op.notes ?? ""} />
                {isTrade ? <TradePreview fixedType={op.type as "BUY" | "SELL"} /> : null}
                <Field name="reason" label="Motivo da correção" as="textarea" />
              </ActionForm>
            </CardContent>
          </Card>

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle>Cancelar</CardTitle>
              <CardDescription>
                A operação deixa de contar na posição, mas continua visível no histórico. Não é possível
                cancelar se isso deixar uma venda sem cotas suficientes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={cancelOperationAction.bind(null, op.id)} submitLabel="Cancelar operação" submitVariant="destructive" testId="cancel-form">
                <Field name="reason" label="Motivo do cancelamento" as="textarea" />
              </ActionForm>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Trilha de auditoria</CardTitle></CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem eventos.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {audit.map((e) => {
                const reason =
                  e.data && typeof e.data === "object" && !Array.isArray(e.data) && "reason" in e.data
                    ? String(e.data.reason)
                    : null;
                return (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
                    <span>{ACTION_LABEL[e.action] ?? e.action}{reason ? ` — ${reason}` : ""}</span>
                    <span className="text-muted-foreground"><Timestamp value={e.createdAt} /></span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
