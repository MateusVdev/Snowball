import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Field, FormNote } from "@/components/forms/action-form";
import { PageHeader } from "@/components/portfolio/page-header";
import { SEGMENT_SUGGESTIONS } from "@/components/portfolio/segments";
import { Quantity } from "@/components/portfolio/values";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  archiveFundAction,
  restoreFundAction,
  updateFundAction,
} from "@/server/actions/portfolio";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getFundByTicker } from "@/server/services/portfolio/fund-service";

export const metadata: Metadata = { title: "Editar fundo" };

export default async function EditFundPage({ params }: PageProps<"/carteira/[ticker]/editar">) {
  const user = await requireUser();
  const { ticker } = await params;
  const fund = await getFundByTicker(getDb(), user.id, decodeURIComponent(ticker));
  if (!fund) notFound();
  const hasQuantity = !fund.metrics.quantity.isZero();

  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader
        title={`Editar ${fund.ticker}`}
        description={<Link className="underline" href={`/carteira/${fund.ticker}`}>Voltar para a posição</Link>}
      />

      <Card>
        <CardHeader>
          <CardTitle>Informações do fundo</CardTitle>
          <CardDescription>
            O ticker não pode ser alterado. Quantidade e preço médio só mudam por meio de operações.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={updateFundAction.bind(null, fund.fundId)} submitLabel="Salvar alterações" testId="edit-fund-form">
            <Field name="name" label="Nome" defaultValue={fund.name ?? ""} />
            <Field name="segment" label="Segmento" defaultValue={fund.segment ?? ""} list="segment-options" />
            <Field name="notes" label="Observações" as="textarea" defaultValue={fund.notes ?? ""} />
          </ActionForm>
          <datalist id="segment-options">
            {SEGMENT_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
          </datalist>
        </CardContent>
      </Card>

      {fund.archivedAt ? (
        <Card>
          <CardHeader>
            <CardTitle>Restaurar fundo</CardTitle>
            <CardDescription>O fundo voltará a aparecer na carteira e a aceitar operações.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={restoreFundAction.bind(null, fund.fundId, fund.ticker)} submitLabel="Restaurar" submitVariant="secondary">
              <FormNote>O histórico foi preservado durante o arquivamento.</FormNote>
            </ActionForm>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Remover da carteira</CardTitle>
            <CardDescription>
              O fundo é arquivado: sai da carteira, mas operações e cotações continuam no histórico e ele
              pode ser restaurado. Nada é apagado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasQuantity ? (
              <FormNote>
                Há <Quantity value={fund.metrics.quantity} /> cota(s) em carteira. Registre a venda (ou
                cancele/corrija as operações) antes de remover.
              </FormNote>
            ) : (
              <ActionForm
                action={archiveFundAction.bind(null, fund.fundId, fund.ticker)}
                submitLabel="Remover (arquivar)"
                submitVariant="destructive"
                testId="archive-form"
              >
                <Field name="confirm" label={`Digite ${fund.ticker} para confirmar`} />
              </ActionForm>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
