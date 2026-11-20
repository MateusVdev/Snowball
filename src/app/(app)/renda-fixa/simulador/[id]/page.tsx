import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, CheckboxField } from "@/components/forms/action-form";
import { SimulationResultView } from "@/components/fixed-income/simulation-result";
import { PageHeader } from "@/components/portfolio/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteFixedIncomeSimulationAction } from "@/server/actions/fixed-income-simulation";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { ServiceError } from "@/server/services/errors";
import { getFixedIncomeSimulation } from "@/server/services/fixed-income/simulation-service";

export const metadata: Metadata = { title: "Simulação de renda fixa" };

export default async function SavedFixedIncomeSimulationPage({ params }: PageProps<"/renda-fixa/simulador/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  let data;
  try {
    data = await getFixedIncomeSimulation(getDb(), user.id, id);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { simulation, config, result } = data;
  const query = new URLSearchParams({
    id: simulation.id,
    initialAmount: config.initialAmount.replace(".", ","),
    monthlyContribution: config.monthlyContribution.replace(".", ","),
    termValue: String(config.termValue),
    termUnit: config.termUnit,
    rateMode: config.rateMode,
    cdiPercent: (config.cdiPercent ?? "").replace(".", ","),
    annualRatePercent: (config.annualRatePercent ?? "").replace(".", ","),
    cdiAnnualPercent: (config.cdiAnnualPercent ?? "").replace(".", ","),
    ...(config.taxExempt ? { taxExempt: "on" } : {}),
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        title={simulation.name}
        description="Simulação de renda fixa salva (hipotética; não altera a carteira)."
        actions={
          <>
            <Button asChild variant="outline"><Link href="/renda-fixa/simulador">Simulador</Link></Button>
            <Button asChild><Link href={`/renda-fixa/simulador?${query}`}>Editar parâmetros</Link></Button>
          </>
        }
      />
      <SimulationResultView config={config} result={result} />
      <Card>
        <CardHeader><CardTitle>Excluir simulação</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={deleteFixedIncomeSimulationAction.bind(null, simulation.id)} submitLabel="Excluir" submitVariant="destructive" testId="fi-sim-delete-form">
            <CheckboxField name="confirm" label="Confirmo a exclusão desta simulação" />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
