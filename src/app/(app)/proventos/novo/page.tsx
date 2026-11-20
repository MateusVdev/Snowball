import type { Metadata } from "next";
import { ActionForm, Field, FormNote } from "@/components/forms/action-form";
import { PageHeader } from "@/components/portfolio/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { registerDividendAction } from "@/server/actions/market";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { listFundOptions } from "@/server/services/portfolio/fund-service";

export const metadata: Metadata = { title: "Registrar provento" };

export default async function NewDividendPage({ searchParams }: PageProps<"/proventos/novo">) {
  const user = await requireUser();
  const params = await searchParams;
  const funds = (await listFundOptions(getDb(), user.id)).filter((f) => !f.archivedAt);
  const pre = typeof params.fundo === "string" ? funds.find((f) => f.ticker === params.fundo?.toString().toUpperCase()) : undefined;

  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="Registrar provento" description="Cadastro manual de provento anunciado/pago ou de uma previsão sua." />
      <Card>
        <CardContent>
          <ActionForm action={registerDividendAction} submitLabel="Registrar" testId="dividend-form">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                name="fundId"
                label="Fundo"
                as="select"
                defaultValue={pre?.id ?? ""}
                options={[{ value: "", label: "Selecione…" }, ...funds.map((f) => ({ value: f.id, label: f.ticker }))]}
              />
              <Field
                name="kind"
                label="Natureza"
                as="select"
                defaultValue="OFFICIAL"
                options={[
                  { value: "OFFICIAL", label: "Anunciado oficialmente" },
                  { value: "FORECAST", label: "Previsão (estimativa minha)" },
                ]}
              />
              <Field
                name="type"
                label="Tipo"
                as="select"
                defaultValue="INCOME"
                options={[
                  { value: "INCOME", label: "Rendimento" },
                  { value: "AMORTIZATION", label: "Amortização" },
                ]}
              />
              <Field name="ratePerShare" label="Valor por cota (R$)" inputMode="decimal" placeholder="0,10" hint="Até 10 casas decimais" />
              <Field name="dataCom" label="Data-com (data-base)" type="date" />
              <Field name="paymentDate" label="Data de pagamento (opcional)" type="date" />
              <Field name="competence" label="Competência (opcional)" type="month" />
            </div>
            <Field name="notes" label="Observações / fonte consultada" as="textarea" />
            <FormNote>
              A quantidade elegível e o valor total são calculados pelo seu histórico de operações na data-com.
              Previsões nunca são exibidas como anúncio e não podem ser marcadas como recebidas.
            </FormNote>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
