import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Field, FormNote } from "@/components/forms/action-form";
import { PageHeader } from "@/components/portfolio/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { registerInitialBalanceAction } from "@/server/actions/portfolio";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getFundByTicker } from "@/server/services/portfolio/fund-service";

export const metadata: Metadata = { title: "Saldo inicial" };

export default async function InitialBalancePage({ params }: PageProps<"/carteira/[ticker]/saldo-inicial">) {
  const user = await requireUser();
  const { ticker } = await params;
  const fund = await getFundByTicker(getDb(), user.id, decodeURIComponent(ticker));
  if (!fund) notFound();

  return (
    <div className="grid max-w-xl gap-6">
      <PageHeader
        title={`Saldo inicial — ${fund.ticker}`}
        description={<Link className="underline" href={`/carteira/${fund.ticker}`}>Voltar para a posição</Link>}
      />
      <Card>
        <CardContent>
          <ActionForm
            action={registerInitialBalanceAction.bind(null, fund.fundId, fund.ticker)}
            submitLabel="Registrar saldo inicial"
          >
            <FormNote>
              Quantidade e preço médio que você já possuía antes das operações registradas. Não é
              necessário informar datas. Só pode existir um saldo inicial ativo por fundo.
            </FormNote>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="quantity" label="Quantidade de cotas" inputMode="numeric" />
              <Field name="averagePrice" label="Preço médio (R$)" inputMode="decimal" />
            </div>
            <Field name="notes" label="Observações (opcional)" as="textarea" />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
