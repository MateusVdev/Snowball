import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, CheckboxField, Field, FormNote } from "@/components/forms/action-form";
import { GoalProgressBar, formatGoalValue } from "@/components/overview/goal-progress";
import { PageHeader } from "@/components/portfolio/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { createGoalAction, deleteGoalAction, updateGoalAction } from "@/server/actions/goals";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import { listGoalStatuses } from "@/server/services/goals/goal-service";
import { getOverview } from "@/server/services/overview/overview-service";
import { listSimulations } from "@/server/services/simulation/simulation-service";
import { listFixedIncomeSimulations } from "@/server/services/fixed-income/simulation-service";
import { GOAL_METRIC_LABEL } from "@/domain/goals";

export const metadata: Metadata = { title: "Metas financeiras" };

// "Patrimônio" (metas antigas) continua sendo só FIIs; o patrimônio total é um tipo à parte.
const METRIC_OPTIONS = [
  { value: "MONTHLY_INCOME", label: "Renda mensal (R$)" },
  { value: "PATRIMONY", label: "Patrimônio — só FIIs (R$)" },
  { value: "TOTAL_PATRIMONY", label: "Patrimônio total — FIIs + renda fixa (R$)" },
  { value: "TOTAL_SHARES", label: "Quantidade de cotas" },
  { value: "CUSTOM", label: "Objetivo personalizado" },
];

export default async function GoalsPage() {
  const user = await requireUser();
  const db = getDb();
  const [overview, sims, fiSims] = await Promise.all([
    getOverview(db, user.id, { staleAfterBusinessHours: getIntegrations().staleAfterBusinessHours }),
    listSimulations(db, user.id),
    listFixedIncomeSimulations(db, user.id),
  ]);
  const goals = await listGoalStatuses(db, user.id, overview);
  const simOptions = [{ value: "", label: "Sem estimativa" }, ...sims.map((s) => ({ value: s.id, label: s.name }))];
  const fiSimOptions = [{ value: "", label: "Nenhuma" }, ...fiSims.map((s) => ({ value: s.id, label: s.name }))];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Metas financeiras"
        description="Progresso medido pelos seus registros; prazo estimado pelas premissas de uma simulação (hipotético)."
      />

      {goals.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">Nenhuma meta criada ainda.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {goals.map((g) => (
            <Card key={g.id} data-testid={`goal-${g.name}`}>
              <CardContent className="grid gap-4">
                <GoalProgressBar goal={g} />
                <div className="grid gap-1 text-sm">
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    Valor atual: {formatGoalValue(g.metric, g.current)} <InfoTip>{g.currentNote}</InfoTip>
                  </p>
                  <p className="text-xs text-muted-foreground" data-testid="goal-metric">{GOAL_METRIC_LABEL[g.metric]}</p>
                  <p>
                    Estimativa:{" "}
                    {g.estimate ? (
                      g.estimate.months ? (
                        <strong>{g.estimate.label}</strong>
                      ) : (
                        <span className="text-muted-foreground">não alcançada no prazo da simulação</span>
                      )
                    ) : (
                      <span className="text-muted-foreground">vincule uma simulação para estimar o prazo</span>
                    )}
                    {g.estimate ? <span className="block text-xs text-muted-foreground">{g.estimate.note}</span> : null}
                  </p>
                  {g.simulation ? (
                    <p className="text-xs">Simulação: <Link className="underline" href={`/simulador/${g.simulation.id}`}>{g.simulation.name}</Link></p>
                  ) : null}
                </div>
                <details>
                  <summary className="cursor-pointer text-sm">Editar ou excluir</summary>
                  <div className="mt-3 grid gap-4">
                    <ActionForm action={updateGoalAction.bind(null, g.id)} submitLabel="Salvar meta" submitVariant="secondary">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field name="name" label="Nome" defaultValue={g.name} />
                        <Field name="metric" label="Tipo" as="select" defaultValue={g.metric} options={METRIC_OPTIONS} />
                        <Field name="target" label="Meta" inputMode="decimal" defaultValue={g.target.toFixed()} />
                        <Field name="customCurrent" label="Valor atual (só personalizada)" inputMode="decimal" defaultValue={g.customCurrent ?? ""} />
                        <Field name="simulationId" label="Estimar com a simulação (FIIs)" as="select" defaultValue={g.simulation?.id ?? ""} options={simOptions} />
                        <Field name="fixedIncomeSimulationId" label="Simulação de renda fixa (só patrimônio total)" as="select" defaultValue={g.fixedIncomeSimulation?.id ?? ""} options={fiSimOptions} />
                      </div>
                    </ActionForm>
                    <ActionForm action={deleteGoalAction.bind(null, g.id)} submitLabel="Excluir meta" submitVariant="destructive">
                      <CheckboxField name="confirm" label="Confirmo a exclusão desta meta" />
                    </ActionForm>
                  </div>
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Nova meta</CardTitle>
          <CardDescription>
            Renda mensal usa a renda recorrente estimada (cotas atuais × último rendimento pago). “Patrimônio — só FIIs” usa o valor de
            mercado dos FIIs; “Patrimônio total” soma a renda fixa (valor bruto estimado). Para estimar o prazo, escolha uma simulação — por
            exemplo, uma criada a partir da sua carteira; no patrimônio total, some também uma simulação de renda fixa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={createGoalAction} submitLabel="Criar meta" testId="goal-form">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field name="name" label="Nome" placeholder="Ex.: R$ 100 por mês" />
              <Field name="metric" label="Tipo" as="select" defaultValue="MONTHLY_INCOME" options={METRIC_OPTIONS} />
              <Field name="target" label="Meta" inputMode="decimal" placeholder="100,00" />
              <Field name="customCurrent" label="Valor atual (só personalizada)" inputMode="decimal" />
              <Field name="simulationId" label="Estimar com a simulação (FIIs)" as="select" defaultValue="" options={simOptions} className="sm:col-span-2" />
              <Field name="fixedIncomeSimulationId" label="Simulação de renda fixa (só patrimônio total)" as="select" defaultValue="" options={fiSimOptions} className="sm:col-span-2" />
            </div>
            {sims.length === 0 ? (
              <FormNote>
                Nenhuma simulação salva. <Link className="underline" href="/simulador/nova?origem=carteira">Crie uma a partir da carteira</Link> para estimar prazos.
              </FormNote>
            ) : null}
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
