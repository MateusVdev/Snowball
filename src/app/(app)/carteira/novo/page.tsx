import type { Metadata } from "next";
import { ActionForm, CheckboxField, Field, FormNote } from "@/components/forms/action-form";
import { PageHeader } from "@/components/portfolio/page-header";
import { SEGMENT_SUGGESTIONS } from "@/components/portfolio/segments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createFundAction } from "@/server/actions/portfolio";
import { requireUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Adicionar FII" };

export default async function NewFundPage() {
  await requireUser();
  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="Adicionar FII" description="Cadastre o fundo e, se já possuir cotas, informe o saldo inicial." />
      <ActionForm action={createFundAction} submitLabel="Cadastrar fundo" testId="create-fund-form">
        <Card>
          <CardHeader><CardTitle>Fundo</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field name="ticker" label="Ticker" placeholder="MXRF11" hint="4 letras + 2 dígitos" />
            <Field name="segment" label="Segmento (opcional)" list="segment-options" />
            <Field name="name" label="Nome (opcional)" className="sm:col-span-2" />
            <Field name="notes" label="Observações (opcional)" as="textarea" className="sm:col-span-2" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Saldo inicial (opcional)</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <FormNote>
              Use para cotas que você já possui e cujas compras não serão registradas uma a uma. O saldo
              inicial não tem data e entra no cálculo antes de todas as operações.
            </FormNote>
            <CheckboxField name="hasInitialBalance" label="Informar saldo inicial" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="quantity" label="Quantidade de cotas" inputMode="numeric" />
              <Field name="averagePrice" label="Preço médio (R$)" inputMode="decimal" placeholder="8,44" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Cotação manual (opcional)</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field name="quotePrice" label="Cotação de referência (R$)" inputMode="decimal" placeholder="8,52" />
            <Field name="quoteReferenceDate" label="Data de referência (opcional)" type="date" />
          </CardContent>
        </Card>
      </ActionForm>
      <datalist id="segment-options">
        {SEGMENT_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}
