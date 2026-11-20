import type { Metadata } from "next";
import { ActionForm, Field, FormNote } from "@/components/forms/action-form";
import { AssetFields } from "@/components/fixed-income/asset-fields";
import { EstimateNotice } from "@/components/fixed-income/estimate-notice";
import { PageHeader } from "@/components/portfolio/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { todayIsoDate } from "@/domain/dates";
import { createFixedIncomeAssetAction } from "@/server/actions/fixed-income";
import { requireUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Adicionar título" };

export default async function NewFixedIncomePage() {
  await requireUser();
  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader title="Adicionar título" description="Cadastre um CDB, caixinha, LCI/LCA ou Tesouro Selic." />
      <EstimateNotice />
      <ActionForm action={createFixedIncomeAssetAction} submitLabel="Cadastrar título" testId="create-fixed-income-form">
        <Card>
          <CardHeader><CardTitle>Título</CardTitle></CardHeader>
          <CardContent>
            <AssetFields />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Aporte inicial (opcional)</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <FormNote>
              Para um saldo que você já tem, informe o valor aplicado e a data aproximada. Depois é possível adicionar outros
              aportes e resgates.
            </FormNote>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="initialAmount" label="Valor aplicado (R$)" inputMode="decimal" placeholder="91,00" />
              <Field name="initialDate" label="Data do aporte" type="date" defaultValue={todayIsoDate()} max={todayIsoDate()} />
            </div>
          </CardContent>
        </Card>
      </ActionForm>
    </div>
  );
}
