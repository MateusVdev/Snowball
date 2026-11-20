import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Field, FormNote } from "@/components/forms/action-form";
import { DataSourceBadge, DividendStatusBadge, ReceivedBadge, dividendTypeLabel } from "@/components/dividends/badges";
import { PageHeader } from "@/components/portfolio/page-header";
import { CalendarDate, Money, Quantity, Timestamp, UnitPrice } from "@/components/portfolio/values";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmReceiptAction, voidDividendAction, voidReceiptAction } from "@/server/actions/market";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getDividendEvent } from "@/server/services/dividends/dividend-service";

export const metadata: Metadata = { title: "Provento" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default async function DividendPage({ params }: PageProps<"/proventos/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const data = await getDividendEvent(getDb(), user.id, id);
  if (!data) notFound();
  const { event: e, receipts } = data;
  const canReceive = !e.voidedAt && e.kind === "OFFICIAL" && e.status === "PAID" && !e.receipt;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {dividendTypeLabel(e.type)} · {e.ticker}
            <DividendStatusBadge status={e.status} />
            {e.receipt ? <ReceivedBadge /> : null}
            {e.voidedAt ? <span className="text-sm text-destructive">Anulado</span> : null}
          </span>
        }
        description={<Link className="underline" href="/proventos">Voltar para proventos</Link>}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Dados do provento</CardTitle></CardHeader>
          <CardContent>
            <dl>
              <Row label="Valor por cota"><UnitPrice value={e.ratePerShare} /></Row>
              <Row label="Data-com (data-base)"><CalendarDate value={e.dataCom} /></Row>
              <Row label="Data de pagamento"><CalendarDate value={e.paymentDate} empty="A definir" /></Row>
              <Row label="Competência">{e.competence ?? e.referenceLabel ?? "—"}</Row>
              {e.approvedOn ? <Row label="Aprovação"><CalendarDate value={e.approvedOn} /></Row> : null}
              <Row label="Fonte"><DataSourceBadge source={e.source} verified={e.verified} /></Row>
              <Row label="Natureza">{e.kind === "OFFICIAL" ? "Oficial" : "Previsão (estimativa sua — não é anúncio)"}</Row>
              {e.notes ? <Row label="Observações">{e.notes}</Row> : null}
              <Row label="Registrado em"><Timestamp value={e.createdAt} /></Row>
              {e.voidReason ? <Row label="Motivo da anulação">{e.voidReason}</Row> : null}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quantidade elegível</CardTitle>
            <CardDescription>Posição ao final da data-com, calculada pelo histórico de operações.</CardDescription>
          </CardHeader>
          <CardContent>
            {e.eligibility.status === "KNOWN" ? (
              <dl>
                <Row label="Cotas na data-com"><Quantity value={e.eligibility.quantity} /></Row>
                <Row label="Valor total esperado"><Money value={e.expectedAmount} /></Row>
              </dl>
            ) : (
              <FormNote>Desconhecida: {e.eligibility.reason}</FormNote>
            )}
            {e.receipt ? (
              <dl className="mt-4">
                <Row label="Recebido">
                  <Money value={e.receipt.totalAmount} /> (<Quantity value={e.receipt.eligibleQuantity} /> cota(s),{" "}
                  {e.receipt.quantitySource === "LEDGER" ? "pelo histórico" : "informada por você"})
                </Row>
              </dl>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {canReceive ? (
        <Card>
          <CardHeader>
            <CardTitle>Registrar recebimento</CardTitle>
            <CardDescription>
              Deixe a quantidade em branco para usar a do histórico. Informe-a se a elegibilidade for desconhecida ou se
              o valor creditado considerou outra quantidade.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={confirmReceiptAction.bind(null, e.id)} submitLabel="Registrar recebimento" testId="receipt-form">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="quantity" label="Quantidade elegível (opcional)" inputMode="numeric" />
              </div>
              <Field name="notes" label="Observações" as="textarea" />
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {receipts.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Recebimentos</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            {receipts.map((r) => (
              <div key={r.id} className="grid gap-2 border-b pb-4 last:border-0">
                <div className="text-sm">
                  <Money value={r.totalAmount} /> · <Quantity value={r.eligibleQuantity} /> cota(s) × <UnitPrice value={r.ratePerShare} /> · pago em{" "}
                  <CalendarDate value={r.paymentDate} /> · registrado em <Timestamp value={r.createdAt} />
                  {r.voidedAt ? <span className="text-destructive"> · anulado ({r.voidReason})</span> : null}
                </div>
                {!r.voidedAt ? (
                  <ActionForm action={voidReceiptAction.bind(null, r.id, e.id)} submitLabel="Anular recebimento" submitVariant="destructive">
                    <Field name="reason" label="Motivo" />
                  </ActionForm>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {!e.voidedAt && !e.receipt ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Anular provento</CardTitle>
            <CardDescription>Fica no histórico como anulado, com o motivo. Nada é apagado.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={voidDividendAction.bind(null, e.id)} submitLabel="Anular" submitVariant="destructive" testId="void-dividend-form">
              <Field name="reason" label="Motivo" />
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
