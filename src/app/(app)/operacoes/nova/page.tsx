import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, FormNote } from "@/components/forms/action-form";
import { PageHeader } from "@/components/portfolio/page-header";
import { TradePreview } from "@/components/portfolio/trade-preview";
import { Card, CardContent } from "@/components/ui/card";
import { todayIsoDate } from "@/domain/dates";
import { registerTradeAction } from "@/server/actions/portfolio";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { listFundOptions } from "@/server/services/portfolio/fund-service";

export const metadata: Metadata = { title: "Registrar operação" };

export default async function NewOperationPage({ searchParams }: PageProps<"/operacoes/nova">) {
  const user = await requireUser();
  const params = await searchParams;
  const funds = (await listFundOptions(getDb(), user.id)).filter((f) => !f.archivedAt);
  const preselected = typeof params.fundo === "string" ? params.fundo.toUpperCase() : "";
  const selectedFund = funds.find((f) => f.ticker === preselected);
  const type = params.tipo === "SELL" ? "SELL" : "BUY";

  if (funds.length === 0) {
    return (
      <div className="grid max-w-xl gap-4">
        <PageHeader title="Registrar operação" />
        <p className="text-muted-foreground">
          Cadastre um fundo antes de registrar operações.{" "}
          <Link className="underline" href="/carteira/novo">Adicionar FII</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="Registrar operação" description="Compra ou venda de cotas, com taxas e data do pregão." />
      <Card>
        <CardContent>
          <ActionForm action={registerTradeAction} submitLabel="Registrar operação" testId="trade-form">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                name="fundId"
                label="Fundo"
                as="select"
                defaultValue={selectedFund?.id ?? ""}
                options={[
                  { value: "", label: "Selecione…" },
                  ...funds.map((f) => ({ value: f.id, label: f.ticker })),
                ]}
              />
              <Field
                name="type"
                label="Tipo"
                as="select"
                defaultValue={type}
                options={[
                  { value: "BUY", label: "Compra" },
                  { value: "SELL", label: "Venda" },
                ]}
              />
              <Field name="tradeDate" label="Data da operação" type="date" defaultValue={todayIsoDate()} max={todayIsoDate()} />
              <Field name="quantity" label="Quantidade de cotas" inputMode="numeric" />
              <Field name="unitPrice" label="Preço unitário (R$)" inputMode="decimal" />
              <Field name="fees" label="Taxas (R$)" inputMode="decimal" defaultValue="0" hint="Corretagem, emolumentos etc." />
            </div>
            <Field name="notes" label="Observações (opcional)" as="textarea" />
            <TradePreview />
            <FormNote>
              Compras recalculam o preço médio (taxas incluídas no custo). Vendas usam o preço médio atual
              para apurar o resultado realizado e não alteram o preço médio das cotas restantes.
            </FormNote>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
