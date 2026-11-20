"use client";

import { useActionState, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatBRL } from "@/domain/money";
import {
  REINVESTMENT_OPTIONS,
  defaultFund,
  simulate,
  type GrowthRule,
  type SimFundConfig,
  type SimulationConfig,
} from "@/domain/simulation";
import { parseSimulationConfig } from "@/validation/simulation";
import type { FormState } from "@/server/actions/form-state";
import type { PortfolioFundOption } from "@/server/services/simulation/simulation-service";

/**
 * Editor de simulação. Mantém a configuração em estado local; a prévia usa o
 * mesmo schema e o mesmo motor do servidor. Ao salvar, envia o JSON para a
 * Server Action, que valida e recalcula novamente.
 */

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function GrowthField({ label, value, onChange }: { label: string; value: GrowthRule; onChange: (v: GrowthRule) => void }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <NativeSelect value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as GrowthRule["mode"] })} aria-label={`${label}: modo`}>
          <option value="CONSTANT">Constante</option>
          <option value="MONTHLY">% ao mês</option>
          <option value="ANNUAL">% ao ano</option>
        </NativeSelect>
        {value.mode !== "CONSTANT" ? (
          <Input className="w-24" inputMode="decimal" value={value.ratePercent} onChange={(e) => onChange({ ...value, ratePercent: e.target.value })} aria-label={`${label}: taxa %`} />
        ) : null}
      </div>
    </Field>
  );
}

const MONTH_PRESETS = [12, 24, 60, 120, 240, 360];

export function SimulationEditor({
  action,
  initialConfig,
  initialName,
  initialDescription,
  warnings = [],
  portfolioFunds = [],
}: {
  action: Action;
  initialConfig: SimulationConfig;
  initialName: string;
  initialDescription: string;
  warnings?: string[];
  portfolioFunds?: PortfolioFundOption[];
}) {
  const [config, setConfig] = useState<SimulationConfig>(initialConfig);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [state, formAction, pending] = useActionState(action, {});
  const [pick, setPick] = useState("");
  const deferred = useDeferredValue(config);

  const preview = useMemo(() => {
    try {
      const parsed = parseSimulationConfig(deferred);
      return { ok: true as const, result: simulate(parsed) };
    } catch (error) {
      const message =
        error instanceof z.ZodError ? error.issues.map((i) => i.message).slice(0, 3).join(" · ") : error instanceof Error ? error.message : "Configuração inválida.";
      return { ok: false as const, message };
    }
  }, [deferred]);

  const set = <K extends keyof SimulationConfig>(key: K, value: SimulationConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));
  const setFund = (index: number, patch: Partial<SimFundConfig>) =>
    setConfig((c) => ({ ...c, funds: c.funds.map((f, i) => (i === index ? { ...f, ...patch } : f)) }));
  const nextKey = () => `F${Math.max(0, ...config.funds.map((f) => Number(f.key.replace(/\D/g, "")) || 0)) + 1}`;
  const fundOptions = config.funds.map((f) => ({ value: f.key, label: f.ticker || f.key }));
  const alloc = config.allocation;

  const weightsOf = () => (alloc.mode === "SAME_FUND" ? alloc.contributionWeights : alloc.mode === "WEIGHTS" ? alloc.weights : {});
  const setWeight = (key: string, value: string) => {
    if (alloc.mode === "SAME_FUND") set("allocation", { ...alloc, contributionWeights: { ...alloc.contributionWeights, [key]: value } });
    if (alloc.mode === "WEIGHTS") set("allocation", { ...alloc, weights: { ...alloc.weights, [key]: value } });
  };

  return (
    <form action={formAction} className="grid gap-6" data-testid="simulation-editor">
      <input type="hidden" name="config" value={JSON.stringify(config)} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="description" value={description} />

      <Alert>
        <AlertCircle aria-hidden />
        <AlertDescription>
          Simulação hipotética: premissas definidas por você, sem garantia de dividendos ou preços. Nada aqui altera a sua carteira real.
        </AlertDescription>
      </Alert>
      {warnings.length ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>
            <ul className="list-disc pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Identificação e prazo</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Nome" className="sm:col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome da simulação" /></Field>
          <Field label="Prazo (meses)" hint={`= ${(config.months / 12).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} anos`}>
            <Input type="number" min={1} max={600} value={config.months} onChange={(e) => set("months", Number(e.target.value))} aria-label="Prazo em meses" />
          </Field>
          <Field label="Atalhos">
            <div className="flex flex-wrap gap-1">
              {MONTH_PRESETS.map((m) => (
                <Button key={m} type="button" size="sm" variant={config.months === m ? "default" : "outline"} onClick={() => set("months", m)}>
                  {m >= 12 ? `${m / 12}a` : `${m}m`}
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Descrição (opcional)" className="sm:col-span-2 lg:col-span-4">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Mês inicial (opcional, só rótulo)"><Input type="month" value={config.startMonth ?? ""} onChange={(e) => set("startMonth", e.target.value || null)} /></Field>
          <Field label="Saldo inicial em caixa (R$)"><Input inputMode="decimal" value={config.initialCash} onChange={(e) => set("initialCash", e.target.value)} aria-label="Saldo inicial" /></Field>
          <Field label="Aporte mensal (R$)"><Input inputMode="decimal" value={config.monthlyContribution} onChange={(e) => set("monthlyContribution", e.target.value)} aria-label="Aporte mensal" /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modelo de cálculo</CardTitle>
          <CardDescription>
            Mensal simplificado: dividendos sobre as cotas do início do mês; compras no fim do mês; cotas novas rendem a partir do mês
            seguinte. Calendário: usa data-com, pagamento e dia de compra de cada fundo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Modelo">
            <NativeSelect value={config.timing} onChange={(e) => set("timing", e.target.value as SimulationConfig["timing"])} aria-label="Modelo de cálculo">
              <option value="MONTHLY">Mensal simplificado</option>
              <option value="CALENDAR">Calendário (data-com e pagamento)</option>
            </NativeSelect>
          </Field>
          {config.timing === "CALENDAR" ? (
            <>
              <Field label="Dia das compras e aportes (1–28)"><Input type="number" min={1} max={28} value={config.purchaseDay} onChange={(e) => set("purchaseDay", Number(e.target.value))} /></Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={config.initialSharesEligibleBeforeStart} onChange={(e) => set("initialSharesEligibleBeforeStart", e.target.checked)} />
                Cotas iniciais já tinham direito às datas-com anteriores ao mês 1
              </label>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fundos</CardTitle>
          <CardDescription>Somente cotas inteiras são compradas. Não há crescimento presumido: “Constante” é o padrão.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {config.funds.map((f, i) => (
            <fieldset key={f.key} className="grid gap-4 rounded-lg border p-4" data-testid={`sim-fund-${i}`}>
              <legend className="px-1 text-sm font-medium">{f.ticker || `Fundo ${i + 1}`}</legend>
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <Field label="Ticker"><Input value={f.ticker} onChange={(e) => setFund(i, { ticker: e.target.value.toUpperCase() })} aria-label={`Ticker ${i + 1}`} /></Field>
                <Field label="Cotas iniciais"><Input inputMode="numeric" value={f.initialQuantity} onChange={(e) => setFund(i, { initialQuantity: e.target.value })} aria-label={`Cotas iniciais ${i + 1}`} /></Field>
                <Field label="Preço da cota (R$)"><Input inputMode="decimal" value={f.price} onChange={(e) => setFund(i, { price: e.target.value })} aria-label={`Preço ${i + 1}`} /></Field>
                <Field label="Dividendo mensal/cota (R$)"><Input inputMode="decimal" value={f.monthlyDividend} onChange={(e) => setFund(i, { monthlyDividend: e.target.value })} aria-label={`Dividendo ${i + 1}`} /></Field>
                <Field label="Reinvestimento">
                  <NativeSelect value={f.reinvestmentPercent} onChange={(e) => setFund(i, { reinvestmentPercent: e.target.value as SimFundConfig["reinvestmentPercent"] })} aria-label={`Reinvestimento ${i + 1}`}>
                    {REINVESTMENT_OPTIONS.map((o) => <option key={o} value={o}>{o}%</option>)}
                  </NativeSelect>
                </Field>
                <div className="flex items-end">
                  <Button type="button" variant="ghost" size="sm" disabled={config.funds.length === 1} onClick={() => set("funds", config.funds.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden /> Remover
                  </Button>
                </div>
                <GrowthField label="Variação do preço" value={f.priceGrowth} onChange={(v) => setFund(i, { priceGrowth: v })} />
                <GrowthField label="Variação do dividendo" value={f.dividendGrowth} onChange={(v) => setFund(i, { dividendGrowth: v })} />
                {config.timing === "CALENDAR" ? (
                  <>
                    <Field label="Dia da data-com"><Input type="number" min={1} max={28} value={f.calendar.dataComDay} onChange={(e) => setFund(i, { calendar: { ...f.calendar, dataComDay: Number(e.target.value) } })} /></Field>
                    <Field label="Dia do pagamento"><Input type="number" min={1} max={28} value={f.calendar.paymentDay} onChange={(e) => setFund(i, { calendar: { ...f.calendar, paymentDay: Number(e.target.value) } })} /></Field>
                    <Field label="Pagamento após (meses)"><Input type="number" min={0} max={3} value={f.calendar.paymentLagMonths} onChange={(e) => setFund(i, { calendar: { ...f.calendar, paymentLagMonths: Number(e.target.value) } })} /></Field>
                  </>
                ) : null}
              </div>
              <details>
                <summary className="cursor-pointer text-sm">Alterações pontuais de preço/dividendo ({f.priceChanges.length + f.dividendChanges.length})</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(["priceChanges", "dividendChanges"] as const).map((field) => (
                    <div key={field} className="grid gap-2">
                      <p className="text-xs text-muted-foreground">{field === "priceChanges" ? "Novo preço a partir do mês" : "Novo dividendo/cota a partir do mês"}</p>
                      {f[field].map((c, j) => (
                        <div key={j} className="flex gap-2">
                          <Input type="number" min={1} className="w-24" value={c.month} aria-label="Mês" onChange={(e) => setFund(i, { [field]: f[field].map((x, k) => (k === j ? { ...x, month: Number(e.target.value) } : x)) })} />
                          <Input inputMode="decimal" value={c.value} aria-label="Valor" onChange={(e) => setFund(i, { [field]: f[field].map((x, k) => (k === j ? { ...x, value: e.target.value } : x)) })} />
                          <Button type="button" variant="ghost" size="icon" aria-label="Remover alteração" onClick={() => setFund(i, { [field]: f[field].filter((_, k) => k !== j) })}><Trash2 aria-hidden /></Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setFund(i, { [field]: [...f[field], { month: 13, value: field === "priceChanges" ? f.price : f.monthlyDividend }] })}>
                        <Plus aria-hidden /> Adicionar
                      </Button>
                    </div>
                  ))}
                </div>
              </details>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-end gap-2">
            <Button type="button" variant="outline" disabled={config.funds.length >= 20} onClick={() => set("funds", [...config.funds, defaultFund({ key: nextKey(), ticker: "" })])}>
              <Plus aria-hidden /> Adicionar fundo
            </Button>
            {portfolioFunds.length ? (
              <>
                <NativeSelect className="w-56" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Fundo da minha carteira">
                  <option value="">Fundo da minha carteira…</option>
                  {portfolioFunds.map((f) => (
                    <option key={f.ticker} value={f.ticker} disabled={config.funds.some((x) => x.ticker === f.ticker)}>
                      {f.ticker} · {f.quantity} cotas
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!pick || config.funds.length >= 20}
                  onClick={() => {
                    const f = portfolioFunds.find((x) => x.ticker === pick);
                    if (!f) return;
                    set("funds", [
                      ...config.funds,
                      defaultFund({ key: nextKey(), ticker: f.ticker, initialQuantity: f.quantity, price: f.price, monthlyDividend: f.monthlyDividend, ...(f.calendar ? { calendar: f.calendar } : {}) }),
                    ]);
                    setPick("");
                  }}
                >
                  Adicionar da carteira
                </Button>
                <span className="text-xs text-muted-foreground">Copia quantidade, cotação e último rendimento — a carteira não é alterada.</span>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Distribuição dos recursos</CardTitle>
          <CardDescription>Para onde vão os dividendos reinvestidos e os aportes. O troco de cada compra fica guardado para os meses seguintes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Estratégia" className="max-w-md">
            <NativeSelect
              value={alloc.mode}
              aria-label="Estratégia de distribuição"
              onChange={(e) => {
                const mode = e.target.value as SimulationConfig["allocation"]["mode"];
                if (mode === "SAME_FUND") set("allocation", { mode, contributionWeights: {} });
                if (mode === "WEIGHTS") set("allocation", { mode, weights: Object.fromEntries(config.funds.map((f, i) => [f.key, i === 0 ? "100" : "0"])) });
                if (mode === "MANUAL") set("allocation", { mode, purchases: [] });
              }}
            >
              <option value="SAME_FUND">Reinvestir no mesmo fundo que gerou o dividendo</option>
              <option value="WEIGHTS">Por percentual (inclui “tudo em um fundo específico”)</option>
              <option value="MANUAL">Escolha manual das compras</option>
            </NativeSelect>
          </Field>
          {alloc.mode !== "MANUAL" ? (
            <div className="grid gap-3 sm:grid-cols-4">
              {config.funds.map((f) => (
                <Field key={f.key} label={`${alloc.mode === "SAME_FUND" ? "Aportes" : "Recursos"} → ${f.ticker || f.key} (%)`}>
                  <Input inputMode="decimal" value={weightsOf()[f.key] ?? ""} placeholder={alloc.mode === "SAME_FUND" ? "partes iguais" : "0"} onChange={(e) => setWeight(f.key, e.target.value)} />
                </Field>
              ))}
              {alloc.mode === "SAME_FUND" ? <p className="text-xs text-muted-foreground sm:col-span-4">Deixe em branco para dividir os aportes em partes iguais; se preencher, a soma deve ser 100%.</p> : null}
            </div>
          ) : (
            <div className="grid gap-2">
              <p className="text-xs text-muted-foreground">Todo o dinheiro vai para um caixa comum; só são compradas as cotas planejadas abaixo (se houver saldo).</p>
              {alloc.purchases.map((p, j) => (
                <div key={j} className="flex flex-wrap gap-2">
                  <Input type="number" min={1} className="w-24" value={p.month} aria-label="Mês da compra" onChange={(e) => set("allocation", { ...alloc, purchases: alloc.purchases.map((x, k) => (k === j ? { ...x, month: Number(e.target.value) } : x)) })} />
                  <NativeSelect className="w-40" value={p.fundKey} aria-label="Fundo" onChange={(e) => set("allocation", { ...alloc, purchases: alloc.purchases.map((x, k) => (k === j ? { ...x, fundKey: e.target.value } : x)) })}>
                    {fundOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </NativeSelect>
                  <Input type="number" min={1} className="w-24" value={p.quantity} aria-label="Quantidade" onChange={(e) => set("allocation", { ...alloc, purchases: alloc.purchases.map((x, k) => (k === j ? { ...x, quantity: Number(e.target.value) } : x)) })} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remover compra" onClick={() => set("allocation", { ...alloc, purchases: alloc.purchases.filter((_, k) => k !== j) })}><Trash2 aria-hidden /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => set("allocation", { ...alloc, purchases: [...alloc.purchases, { month: 1, fundKey: config.funds[0].key, quantity: 1 }] })}>
                <Plus aria-hidden /> Planejar compra
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Aportes extraordinários</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {config.extraContributions.map((e, j) => (
              <div key={j} className="flex flex-wrap gap-2">
                <Input type="number" min={1} className="w-24" value={e.month} aria-label="Mês do aporte" onChange={(ev) => set("extraContributions", config.extraContributions.map((x, k) => (k === j ? { ...x, month: Number(ev.target.value) } : x)))} />
                <Input inputMode="decimal" className="w-32" value={e.amount} aria-label="Valor do aporte" onChange={(ev) => set("extraContributions", config.extraContributions.map((x, k) => (k === j ? { ...x, amount: ev.target.value } : x)))} />
                <NativeSelect className="w-44" value={e.fundKey ?? ""} aria-label="Destino" onChange={(ev) => set("extraContributions", config.extraContributions.map((x, k) => (k === j ? { ...x, fundKey: ev.target.value || null } : x)))}>
                  <option value="">Conforme estratégia</option>
                  {fundOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </NativeSelect>
                <Button type="button" variant="ghost" size="icon" aria-label="Remover aporte" onClick={() => set("extraContributions", config.extraContributions.filter((_, k) => k !== j))}><Trash2 aria-hidden /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => set("extraContributions", [...config.extraContributions, { month: 1, amount: "100", fundKey: null }])}>
              <Plus aria-hidden /> Adicionar aporte
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Objetivos personalizados</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {config.goals.map((g, j) => (
              <div key={g.id} className="flex flex-wrap gap-2">
                <Input className="w-40" value={g.label} aria-label="Nome do objetivo" onChange={(e) => set("goals", config.goals.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)))} />
                <NativeSelect className="w-44" value={g.metric} aria-label="Métrica" onChange={(e) => set("goals", config.goals.map((x, k) => (k === j ? { ...x, metric: e.target.value as typeof g.metric } : x)))}>
                  <option value="MONTHLY_INCOME">Renda mensal ≥</option>
                  <option value="TOTAL_SHARES">Total de cotas ≥</option>
                  <option value="PATRIMONY">Patrimônio ≥</option>
                  <option value="TOTAL_DIVIDENDS">Dividendos acumulados ≥</option>
                </NativeSelect>
                <Input inputMode="decimal" className="w-28" value={g.target} aria-label="Meta" onChange={(e) => set("goals", config.goals.map((x, k) => (k === j ? { ...x, target: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remover objetivo" onClick={() => set("goals", config.goals.filter((_, k) => k !== j))}><Trash2 aria-hidden /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => set("goals", [...config.goals, { id: `g${Date.now().toString(36)}`, label: "Meu objetivo", metric: "MONTHLY_INCOME", target: "200" }])}>
              <Plus aria-hidden /> Adicionar objetivo
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cenários hipotéticos</CardTitle>
          <CardDescription>
            Cada cenário substitui a variação de preço e de dividendo de todos os fundos por taxas anuais. Valores ilustrativos e editáveis,
            não são projeções. A referência mantém tudo constante.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {config.scenarios.map((s, j) => (
            <fieldset key={s.key} className="grid gap-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">{s.label}</legend>
              {s.key === "REFERENCE" ? (
                <p className="text-xs text-muted-foreground">Preços e dividendos constantes.</p>
              ) : (
                <>
                  <Field label="Preço (% a.a.)"><Input inputMode="decimal" value={s.priceAnnualPercent} onChange={(e) => set("scenarios", config.scenarios.map((x, k) => (k === j ? { ...x, priceAnnualPercent: e.target.value } : x)))} /></Field>
                  <Field label="Dividendo (% a.a.)"><Input inputMode="decimal" value={s.dividendAnnualPercent} onChange={(e) => set("scenarios", config.scenarios.map((x, k) => (k === j ? { ...x, dividendAnnualPercent: e.target.value } : x)))} /></Field>
                </>
              )}
            </fieldset>
          ))}
        </CardContent>
      </Card>

      <Card className="sticky bottom-2 z-10 border-primary/30 shadow-md">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm" aria-live="polite" data-testid="sim-preview">
            {preview.ok ? (
              <>
                Prévia ({config.months} meses): <strong>{preview.result.summary.finalShares}</strong> cotas · renda mensal{" "}
                <strong>{formatBRL(preview.result.summary.finalMonthlyIncome)}</strong> · patrimônio <strong>{formatBRL(preview.result.summary.finalPatrimony)}</strong>
              </>
            ) : (
              <span className="text-destructive">{preview.message}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {state.error ? <span className="text-sm text-destructive" data-testid="form-error">{state.error}</span> : null}
            <Button type="submit" disabled={pending || !preview.ok}>
              {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              Salvar simulação
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
