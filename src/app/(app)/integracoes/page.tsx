import type { Metadata } from "next";
import { ActionForm, CheckboxField, Field, FormNote } from "@/components/forms/action-form";
import { PageHeader } from "@/components/portfolio/page-header";
import { Timestamp } from "@/components/portfolio/values";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { importDividendsAction, refreshPriceHistoryAction, refreshQuotesAction, updateSettingsAction } from "@/server/actions/market";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import { getUserSettings } from "@/server/services/market/auto-refresh";
import { lastSyncRuns, recentSyncRuns } from "@/server/services/market/sync-log";

export const metadata: Metadata = { title: "Integrações" };

const KIND_LABEL = { QUOTES: "Cotações", DIVIDENDS: "Proventos", PRICE_HISTORY: "Histórico de preços", ASSET_INFO: "Dados cadastrais" } as const;
const STATUS_LABEL = { SUCCESS: "Sucesso", PARTIAL: "Parcial", FAILED: "Falhou", SKIPPED: "Ignorado" } as const;
const TRIGGER_LABEL: Record<string, string> = { manual: "Manual", auto: "Automática", cron: "Agendada" };

function StatusBadge({ status }: { status: keyof typeof STATUS_LABEL }) {
  const variant = status === "SUCCESS" ? "secondary" : status === "FAILED" ? "destructive" : "outline";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

export default async function IntegrationsPage() {
  const user = await requireUser();
  const db = getDb();
  const integrations = getIntegrations();
  const [settings, last, runs] = await Promise.all([getUserSettings(db, user.id), lastSyncRuns(db, user.id), recentSyncRuns(db, user.id)]);
  const s = integrations.status;

  return (
    <div className="grid gap-6">
      <PageHeader title="Integrações" description="Fontes externas de cotações, proventos e dados cadastrais." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Provedores</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {!integrations.enabled ? <FormNote>Integrações desativadas (INTEGRATIONS_ENABLED=false). Apenas dados manuais.</FormNote> : null}
            <div>
              <div className="font-medium">brapi — cotações, histórico, proventos, cadastro</div>
              <div className="text-muted-foreground">
                {s.brapiApiKey
                  ? "Chave configurada (BRAPI_API_KEY). O alcance depende do plano contratado."
                  : "Sem chave: a brapi só libera dados públicos de teste (FIIs MXRF11 e HGLG11). Cotação atual de FIIs exige chave."}
                {s.brapiDailyCloseFallback ? " Quando a cotação atual não é liberada, usa o último fechamento diário (identificado como “Fechamento”)." : ""}
              </div>
            </div>
            <div>
              <div className="font-medium">B3 FundosNET — documentos oficiais (avisos de rendimentos e amortizações)</div>
              <div className="text-muted-foreground">
                {s.fundosNetEnabled
                  ? "Ativo para fundos com CNPJ cadastrado. Consultas lentas de propósito (o site bloqueia rajadas)."
                  : "Desativado (FUNDOSNET_ENABLED=false)."}
              </div>
            </div>
            <div>
              <div className="font-medium">Atualização agendada externa</div>
              <div className="text-muted-foreground">
                {s.cronConfigured ? "Endpoint /api/cron/refresh habilitado (CRON_SECRET definido)." : "Endpoint /api/cron/refresh desabilitado (defina CRON_SECRET)."}
              </div>
            </div>
            <div className="text-muted-foreground">Cotação marcada como desatualizada após {integrations.staleAfterBusinessHours} horas úteis.</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Atualização automática</CardTitle>
            <CardDescription>
              Executada em segundo plano ao abrir as páginas, quando o intervalo vence (contado da última tentativa).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={updateSettingsAction} submitLabel="Salvar" testId="settings-form">
              <CheckboxField name="autoUpdateEnabled" label="Ativar atualização automática" defaultChecked={settings.autoUpdateEnabled} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="quoteRefreshMinutes" label="Cotações: a cada (minutos)" type="number" defaultValue={String(settings.quoteRefreshMinutes)} hint="Mínimo 15 (o plano gratuito da brapi atualiza a cada 30 min)" />
                <Field name="dividendRefreshHours" label="Proventos: a cada (horas)" type="number" defaultValue={String(settings.dividendRefreshHours)} hint="Mínimo 1" />
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      </div>

      {integrations.enabled ? (
        <Card>
          <CardHeader><CardTitle>Atualizar agora</CardTitle></CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-3">
            <ActionForm action={refreshQuotesAction} submitLabel="Atualizar cotações" submitVariant="outline">
              <FormNote>Última: {last.QUOTES.last ? <Timestamp value={last.QUOTES.last.startedAt} /> : "nunca"}</FormNote>
            </ActionForm>
            <ActionForm action={importDividendsAction} submitLabel="Importar proventos" submitVariant="outline">
              <FormNote>Última: {last.DIVIDENDS.last ? <Timestamp value={last.DIVIDENDS.last.startedAt} /> : "nunca"}</FormNote>
            </ActionForm>
            <ActionForm action={refreshPriceHistoryAction} submitLabel="Importar histórico de preços" submitVariant="outline">
              <FormNote>Última: {last.PRICE_HISTORY.last ? <Timestamp value={last.PRICE_HISTORY.last.startedAt} /> : "nunca"}</FormNote>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Última atualização</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dado</TableHead>
                <TableHead>Última tentativa</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Último sucesso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
                <TableRow key={k} data-testid={`sync-${k}`}>
                  <TableCell>{KIND_LABEL[k]}</TableCell>
                  <TableCell>{last[k].last ? <Timestamp value={last[k].last!.startedAt} /> : "—"}</TableCell>
                  <TableCell>{last[k].last ? <StatusBadge status={last[k].last!.status} /> : "—"}</TableCell>
                  <TableCell>{last[k].lastSuccess ? <Timestamp value={last[k].lastSuccess!.startedAt} /> : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Registro de execuções</CardTitle></CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma execução ainda.</p>
          ) : (
            <ul className="grid gap-3 text-sm">
              {runs.map((r) => (
                <li key={r.id} className="border-b pb-2 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Timestamp value={r.startedAt} /> · {KIND_LABEL[r.kind]} · {r.provider} · {TRIGGER_LABEL[r.trigger] ?? r.trigger}
                    <StatusBadge status={r.status} />
                    <span className="text-muted-foreground">{r.itemsOk} ok, {r.itemsFailed} falha(s)</span>
                  </div>
                  {r.message ? <div className="text-muted-foreground">{r.message}</div> : null}
                  {Array.isArray(r.details) && r.details.length ? (
                    <details>
                      <summary className="cursor-pointer text-muted-foreground">Detalhes</summary>
                      <ul className="list-disc pl-5">
                        {(r.details as { ticker: string; ok: boolean; message: string }[]).map((d, i) => (
                          <li key={i} className={d.ok ? "" : "text-destructive"}>{d.ticker}: {d.message}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
