import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, CheckboxField, FormNote } from "@/components/forms/action-form";
import { AssetFields } from "@/components/fixed-income/asset-fields";
import { PageHeader } from "@/components/portfolio/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setFixedIncomeArchivedAction, updateFixedIncomeAssetAction } from "@/server/actions/fixed-income";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";

export const metadata: Metadata = { title: "Editar título" };

export default async function EditFixedIncomePage({ params }: PageProps<"/renda-fixa/[id]/editar">) {
  const user = await requireUser();
  const { id } = await params;
  const asset = await getDb().fixedIncomeAsset.findFirst({ where: { id, userId: user.id } });
  if (!asset) notFound();
  const toPt = (v: { toString(): string } | null) => (v === null ? "" : v.toString().replace(".", ","));

  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader title={`Editar ${asset.name}`} description="Mudar a taxa ou a isenção recalcula todo o histórico estimado." />
      <ActionForm action={updateFixedIncomeAssetAction.bind(null, asset.id)} submitLabel="Salvar alterações" testId="edit-fixed-income-form">
        <Card>
          <CardContent className="pt-6">
            <AssetFields
              defaults={{
                name: asset.name,
                issuer: asset.issuer ?? "",
                productType: asset.productType,
                indexer: asset.indexer,
                rate: toPt(asset.rate),
                spreadAnnualPercent: toPt(asset.spreadAnnualPercent),
                taxExempt: asset.taxExempt,
                dailyLiquidity: asset.dailyLiquidity,
                maturityDate: asset.maturityDate ? asset.maturityDate.toISOString().slice(0, 10) : "",
                notes: asset.notes ?? "",
              }}
            />
          </CardContent>
        </Card>
      </ActionForm>

      <Card>
        <CardHeader>
          <CardTitle>{asset.archivedAt ? "Restaurar título" : "Arquivar título"}</CardTitle>
          <CardDescription>
            {asset.archivedAt
              ? "O título volta para a lista e para os totais."
              : "Sai da lista e dos totais, mas nada é apagado (aportes e resgates continuam guardados)."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {asset.archivedAt ? (
            <ActionForm action={setFixedIncomeArchivedAction.bind(null, asset.id, false)} submitLabel="Restaurar" submitVariant="secondary">
              <FormNote>Arquivado.</FormNote>
            </ActionForm>
          ) : (
            <ActionForm action={setFixedIncomeArchivedAction.bind(null, asset.id, true)} submitLabel="Arquivar" submitVariant="destructive">
              <CheckboxField name="confirm" label="Confirmo o arquivamento deste título" />
            </ActionForm>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
