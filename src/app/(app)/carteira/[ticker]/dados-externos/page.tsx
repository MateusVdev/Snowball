import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FormNote } from "@/components/forms/action-form";
import { PageHeader } from "@/components/portfolio/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { applyAssetInfoAction } from "@/server/actions/market";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import { lookupAssetInfo } from "@/server/services/market/asset-info-service";
import { getFundByTicker } from "@/server/services/portfolio/fund-service";

export const metadata: Metadata = { title: "Dados cadastrais externos" };

/** Consulta (ao abrir) os dados cadastrais na fonte e permite aplicar campo a campo. */
export default async function ExternalDataPage({ params }: PageProps<"/carteira/[ticker]/dados-externos">) {
  const user = await requireUser();
  const { ticker } = await params;
  const db = getDb();
  const fund = await getFundByTicker(db, user.id, decodeURIComponent(ticker));
  if (!fund) notFound();
  const integrations = getIntegrations();
  const result = integrations.assetInfo
    ? await lookupAssetInfo(db, user.id, integrations.assetInfo, fund.fundId)
    : { info: null, error: "Integrações desativadas." };
  const info = result.info;

  const rows = info
    ? ([
        ["name", "Nome", fund.name, info.name],
        ["segment", "Segmento", fund.segment, info.segment],
        ["cnpj", "CNPJ", fund.cnpj, info.cnpj],
      ] as const)
    : [];

  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader
        title={`Dados cadastrais — ${fund.ticker}`}
        description={<Link className="underline" href={`/carteira/${fund.ticker}`}>Voltar para a posição</Link>}
      />
      <Card>
        <CardHeader>
          <CardTitle>Sugestões da brapi</CardTitle>
          <CardDescription>
            Nada é alterado automaticamente: as fontes podem divergir (ex.: o segmento informado à CVM pode diferir da
            classificação “papel/tijolo”). Marque apenas o que deseja aplicar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!info ? (
            <FormNote>Não foi possível consultar: {result.error}</FormNote>
          ) : (
            <ActionForm action={applyAssetInfoAction.bind(null, fund.fundId, fund.ticker)} submitLabel="Aplicar selecionados" testId="apply-asset-info">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Campo</th><th>Atual</th><th>Fonte</th><th>Aplicar</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([key, label, current, suggested]) => (
                    <tr key={key} className="border-t">
                      <td className="py-2">{label}</td>
                      <td>{current ?? <span className="text-muted-foreground">não informado</span>}</td>
                      <td>{suggested ?? <span className="text-muted-foreground">não informado</span>}</td>
                      <td>
                        {suggested && suggested !== current ? (
                          <>
                            <input type="hidden" name={key} value={suggested} />
                            <input type="checkbox" name={`apply_${key}`} aria-label={`Aplicar ${label}`} className="size-4" />
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <FormNote>
                Classificação adicional da fonte: {info.segmentType ?? "não informada"} · Administrador: {info.administrator ?? "não informado"}
              </FormNote>
            </ActionForm>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
