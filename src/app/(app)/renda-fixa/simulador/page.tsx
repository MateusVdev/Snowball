import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { ActionForm, Field, HiddenField } from "@/components/forms/action-form";
import { SimulationNotice, SimulationResultView } from "@/components/fixed-income/simulation-result";
import { PageHeader } from "@/components/portfolio/page-header";
import { Money } from "@/components/portfolio/values";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayIsoDate } from "@/domain/dates";
import { isoToBr } from "@/domain/fixed-income/labels";
import { SimulationError, type SimulationResult } from "@/domain/fixed-income/simulation";
import { saveFixedIncomeSimulationAction } from "@/server/actions/fixed-income-simulation";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import {
  listFixedIncomeSimulations,
  runFixedIncomeSimulation,
  simulatorDefaults,
} from "@/server/services/fixed-income/simulation-service";
import type { FixedIncomeSimulationConfig } from "@/validation/fixed-income-simulation";

export const metadata: Metadata = { title: "Simulador de renda fixa" };

type Values = Record<string, string>;
const pt = (v: string | null | undefined) => (v ?? "").replace(".", ",");

function TextField({ name, label, values, errors, hint, inputMode = "decimal" }: {
  name: string; label: string; values: Values; errors: Record<string, string[] | undefined>; hint?: string; inputMode?: "decimal" | "numeric";
}) {
  const err = errors[name]?.[0];
  return (
    <div className="grid gap-2">
      <Label htmlFor={`sim-${name}`}>{label}</Label>
      <Input id={`sim-${name}`} name={name} defaultValue={values[name] ?? ""} inputMode={inputMode} autoComplete="off" aria-invalid={err ? true : undefined} aria-describedby={err || hint ? `sim-${name}-msg` : undefined} />
      {err ? <p id={`sim-${name}-msg`} className="text-sm text-destructive">{err}</p> : hint ? <p id={`sim-${name}-msg`} className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default async function FixedIncomeSimulatorPage({ searchParams }: PageProps<"/renda-fixa/simulador">) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const today = todayIsoDate();
  const [defaults, saved] = await Promise.all([
    simulatorDefaults(db, user.id, getIntegrations().indexRates),
    listFixedIncomeSimulations(db, user.id),
  ]);
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 40) : undefined);
  const submitted = str("termValue") !== undefined;
  const values: Values = submitted
    ? Object.fromEntries(["initialAmount", "monthlyContribution", "termValue", "termUnit", "rateMode", "cdiPercent", "annualRatePercent", "cdiAnnualPercent", "taxExempt"].map((k) => [k, str(k) ?? ""]))
    : {
        initialAmount: pt(defaults.initialAmount),
        monthlyContribution: "",
        termValue: "5",
        termUnit: "YEARS",
        rateMode: "CDI_PERCENT",
        cdiPercent: "100",
        annualRatePercent: "",
        cdiAnnualPercent: pt(defaults.cdi?.annualPercent),
        taxExempt: "",
      };
  const savedId = str("id");

  let errors: Record<string, string[] | undefined> = {};
  let error: string | null = null;
  let run: { config: FixedIncomeSimulationConfig; result: SimulationResult } | null = null;
  const canAutoRun = submitted || (Number(defaults.initialAmount) > 0 && defaults.cdi !== null);
  if (canAutoRun) {
    try {
      run = runFixedIncomeSimulation({ ...values, startDate: today } as never);
    } catch (e) {
      if (e instanceof z.ZodError) {
        errors = z.flattenError(e).fieldErrors as Record<string, string[]>;
        error = "Verifique os campos destacados.";
      } else if (e instanceof SimulationError) error = e.message;
      else throw e;
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Simulador de renda fixa"
        description="Quanto um investimento em renda fixa pode render com aportes mensais — com dias úteis e IR regressivo por aporte."
        actions={<Button asChild variant="outline"><Link href="/renda-fixa">Renda fixa</Link></Button>}
      />
      {!submitted ? <SimulationNotice /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Parâmetros</CardTitle>
          <CardDescription>
            Valor inicial pré-preenchido com o saldo bruto atual da sua renda fixa.{" "}
            {defaults.cdi
              ? `CDI atual: ${pt(defaults.cdi.annualPercent)}% a.a. (taxa de ${isoToBr(defaults.cdi.date)} do Banco Central, anualizada em 252 dias úteis).`
              : "Ainda não há CDI do Banco Central guardado: informe o CDI anual estimado."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" action="/renda-fixa/simulador" className="grid gap-4" data-testid="fi-sim-form" noValidate>
            {savedId ? <input type="hidden" name="id" value={savedId} /> : null}
            {error ? <p className="text-sm text-destructive" role="alert" data-testid="fi-sim-error">{error}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <TextField name="initialAmount" label="Valor inicial (R$)" values={values} errors={errors} />
              <TextField name="monthlyContribution" label="Aporte mensal (R$)" values={values} errors={errors} hint="No início de cada mês" />
              <TextField name="termValue" label="Prazo" values={values} errors={errors} inputMode="numeric" />
              <div className="grid gap-2">
                <Label htmlFor="sim-termUnit">Unidade do prazo</Label>
                <NativeSelect id="sim-termUnit" name="termUnit" defaultValue={values.termUnit || "YEARS"}>
                  <option value="MONTHS">Meses</option>
                  <option value="YEARS">Anos</option>
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sim-rateMode">Rentabilidade</Label>
                <NativeSelect id="sim-rateMode" name="rateMode" defaultValue={values.rateMode || "CDI_PERCENT"}>
                  <option value="CDI_PERCENT">% do CDI</option>
                  <option value="ANNUAL_FIXED">Taxa anual fixa</option>
                </NativeSelect>
              </div>
              <TextField name="cdiPercent" label="% do CDI" values={values} errors={errors} hint="Ex.: 115 (usado com % do CDI)" />
              <TextField name="cdiAnnualPercent" label="CDI anual estimado (% a.a.)" values={values} errors={errors} hint="Editável (usado com % do CDI)" />
              <TextField name="annualRatePercent" label="Taxa anual (% a.a.)" values={values} errors={errors} hint="Ex.: 12 (usado com taxa anual fixa)" />
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="taxExempt" value="on" defaultChecked={values.taxExempt === "on"} className="size-4" />
              Isento de IR (ex.: LCI/LCA)
            </label>
            <div><Button type="submit">Simular</Button></div>
          </form>
        </CardContent>
      </Card>

      {run ? (
        <>
          <SimulationResultView config={run.config} result={run.result} />
          <Card>
            <CardHeader>
              <CardTitle>Salvar simulação</CardTitle>
              <CardDescription>Guarda os parâmetros para abrir depois. Não altera sua carteira.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={saveFixedIncomeSimulationAction} submitLabel={savedId ? "Salvar" : "Salvar simulação"} testId="fi-sim-save-form">
                {(["initialAmount", "monthlyContribution", "termValue", "termUnit", "rateMode", "cdiPercent", "annualRatePercent", "cdiAnnualPercent"] as const).map((k) => (
                  <HiddenField key={k} name={k} value={String(run.config[k] ?? "")} />
                ))}
                <HiddenField name="taxExempt" value={run.config.taxExempt ? "on" : ""} />
                <HiddenField name="startDate" value={run.config.startDate} />
                {savedId ? <HiddenField name="id" value={savedId} /> : null}
                <Field name="name" label="Nome" placeholder="Ex.: Caixinha + R$ 500/mês por 5 anos" />
                {savedId ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="saveAs" value="new" className="size-4" /> Salvar como nova (em vez de atualizar a simulação aberta)
                  </label>
                ) : null}
              </ActionForm>
            </CardContent>
          </Card>
        </>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Simulações salvas</CardTitle></CardHeader>
        <CardContent>
          {saved.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma simulação de renda fixa salva.</p>
          ) : (
            <Table data-testid="fi-sim-saved">
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="text-right">Total aplicado</TableHead>
                  <TableHead className="text-right">Líquido final</TableHead>
                  <TableHead>Atualizada em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {saved.map((s) => {
                  const sum = (s.summary ?? {}) as Record<string, string>;
                  return (
                    <TableRow key={s.id}>
                      <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/renda-fixa/simulador/${s.id}`}>{s.name}</Link></TableCell>
                      <TableCell className="text-right">{sum.totalApplied ? <Money value={sum.totalApplied} /> : "—"}</TableCell>
                      <TableCell className="text-right">{sum.net ? <Money value={sum.net} /> : "—"}</TableCell>
                      <TableCell>{isoToBr(s.updatedAt.toISOString().slice(0, 10))}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
