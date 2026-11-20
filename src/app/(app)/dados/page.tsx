import type { Metadata } from "next";
import { ActionForm, FormNote } from "@/components/forms/action-form";
import { PageHeader } from "@/components/portfolio/page-header";
import { Timestamp } from "@/components/portfolio/values";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { importDividendsAction, refreshPriceHistoryAction, refreshQuotesAction } from "@/server/actions/market";
import { restoreBackupAction } from "@/server/actions/settings";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { DATASET_KEYS, DATASET_LABELS } from "@/server/export/datasets";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import { getUserSettings } from "@/server/services/market/auto-refresh";
import { RestoreForm } from "@/components/data/restore-form";
import { lastSyncRuns, recentSyncRuns } from "@/server/services/market/sync-log";
import { getIndexStatus } from "@/server/services/fixed-income/index-rate-service";
import { refreshIndexRatesAction } from "@/server/actions/fixed-income";
import { isoToBr } from "@/domain/fixed-income/labels";

export const metadata: Metadata = { title: "Central de dados" };

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
  const [settings, last, runs, quoteOrigins, eventOrigins, opCount, receiptCount, indexStatus] = await Promise.all([
    getUserSettings(db, user.id),
    lastSyncRuns(db, user.id),
    recentSyncRuns(db, user.id),
    db.priceQuote.groupBy({ by: ["source"], where: { fund: { userId: user.id } }, _count: { _all: true } }),
    db.dividendEvent.groupBy({ by: ["source", "kind"], where: { userId: user.id, voidedAt: null }, _count: { _all: true } }),
    db.operation.count({ where: { userId: user.id } }),
    db.dividendReceipt.count({ where: { userId: user.id, voidedAt: null } }),
    getIndexStatus(db),
  ]);
  const count = (list: { _count: { _all: number } }[]) => list.reduce((a, x) => a + x._count._all, 0);
  const manualQuotes = count(quoteOrigins.filter((q) => q.source === "MANUAL"));
  const autoQuotes = count(quoteOrigins.filter((q) => q.source !== "MANUAL"));
  const manualEvents = count(eventOrigins.filter((e) => e.source === "MANUAL"));
  const autoEvents = count(eventOrigins.filter((e) => e.source !== "MANUAL"));
  const s = integrations.status;

  return (
    <div className="grid gap-6">
      <PageHeader title="Central de dados" description="Integrações, origem das informações, histórico de atualizações, exportação, backup e restauração." />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Origem dos dados">
        <div className="rounded-xl border bg-card p-4 text-sm"><div className="text-xs uppercase tracking-wide text-muted-foreground">Cotações</div><div className="mt-1 text-lg font-semibold">{manualQuotes} manuais · {autoQuotes} automáticas</div></div>
        <div className="rounded-xl border bg-card p-4 text-sm"><div className="text-xs uppercase tracking-wide text-muted-foreground">Proventos (eventos)</div><div className="mt-1 text-lg font-semibold">{manualEvents} manuais · {autoEvents} importados</div></div>
        <div className="rounded-xl border bg-card p-4 text-sm"><div className="text-xs uppercase tracking-wide text-muted-foreground">Operações</div><div className="mt-1 text-lg font-semibold">{opCount} (sempre manuais)</div></div>
        <div className="rounded-xl border bg-card p-4 text-sm"><div className="text-xs uppercase tracking-wide text-muted-foreground">Recebimentos registrados</div><div className="mt-1 text-lg font-semibold">{receiptCount}</div></div>
      </section>
      <p className="-mt-3 text-xs text-muted-foreground">
        Origens: <strong>Manual</strong> = digitado por você · <strong>brapi</strong> = API brapi.dev · <strong>B3 FundosNET</strong> = documento oficial do administrador · <strong>Banco Central</strong> = CDI/Selic oficiais (renda fixa). A origem aparece ao lado de cada cotação e provento.
      </p>

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
            <div data-testid="provider-bcb">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                Banco Central (CDI/Selic) — índices da renda fixa
                {!integrations.enabled ? (
                  <Badge variant="outline">Desativado</Badge>
                ) : indexStatus.some((i) => i.lastError) ? (
                  <Badge variant="destructive">Última tentativa falhou</Badge>
                ) : indexStatus.some((i) => i.knownUntil) ? (
                  <Badge variant="secondary">Ativo</Badge>
                ) : (
                  <Badge variant="outline">Aguardando primeiro título</Badge>
                )}
              </div>
              <div className="text-muted-foreground">
                API pública do SGS, sem chave. Atualizado ao abrir as telas de renda fixa (no máximo 1× por hora) ou pelo botão.
              </div>
              <ul className="mt-1 grid gap-0.5 text-muted-foreground">
                {indexStatus.map((i) => (
                  <li key={i.indexer} data-testid={`index-status-${i.indexer}`}>
                    <strong className="text-foreground">{i.indexer === "CDI" ? "CDI" : "Selic"}:</strong>{" "}
                    {i.knownUntil ? `taxas até ${isoToBr(i.knownUntil)}` : "nenhuma taxa guardada"}
                    {i.lastSuccessAt ? <> · última atualização <Timestamp value={i.lastSuccessAt} /></> : null}
                    {i.lastError ? <span className="text-destructive"> · erro: {i.lastError}</span> : null}
                  </li>
                ))}
              </ul>
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
            <CardDescription>Configurada em <Link className="underline" href="/configuracoes">Configurações</Link>.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p>Situação: <strong>{settings.autoUpdateEnabled ? "ligada" : "desligada"}</strong></p>
            <p>Cotações a cada {settings.quoteRefreshMinutes} min · proventos a cada {settings.dividendRefreshHours} h (contados da última tentativa).</p>
          </CardContent>
        </Card>
      </div>

      {integrations.enabled ? (
        <Card>
          <CardHeader><CardTitle>Atualizar agora</CardTitle></CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-4">
            <ActionForm action={refreshQuotesAction} submitLabel="Atualizar cotações" submitVariant="outline">
              <FormNote>Última: {last.QUOTES.last ? <Timestamp value={last.QUOTES.last.startedAt} /> : "nunca"}</FormNote>
            </ActionForm>
            <ActionForm action={importDividendsAction} submitLabel="Importar proventos" submitVariant="outline">
              <FormNote>Última: {last.DIVIDENDS.last ? <Timestamp value={last.DIVIDENDS.last.startedAt} /> : "nunca"}</FormNote>
            </ActionForm>
            <ActionForm action={refreshPriceHistoryAction} submitLabel="Importar histórico de preços" submitVariant="outline">
              <FormNote>Última: {last.PRICE_HISTORY.last ? <Timestamp value={last.PRICE_HISTORY.last.startedAt} /> : "nunca"}</FormNote>
            </ActionForm>
            <ActionForm action={refreshIndexRatesAction} submitLabel="Atualizar CDI/Selic" submitVariant="outline">
              <FormNote>Índices do Banco Central para a renda fixa.</FormNote>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Exportação</CardTitle>
            <CardDescription>CSV (separador “;”, decimal com vírgula, abre no Excel em português) ou Excel (.xlsx). Apenas os seus dados.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {/* Download de arquivo (route handler), não navegação entre páginas. */}
            <Button asChild className="w-fit"><a href="/api/export/tudo?formato=xlsx" download data-testid="export-all"><FileSpreadsheet aria-hidden /> Exportar tudo (Excel)</a></Button>
            <ul className="grid gap-2 text-sm">
              {DATASET_KEYS.map((k) => (
                <li key={k} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
                  <span>{DATASET_LABELS[k]}</span>
                  <span className="flex gap-2">
                    <Button asChild size="sm" variant="outline"><a href={`/api/export/${k}?formato=csv`} data-testid={`export-${k}-csv`}><Download aria-hidden /> CSV</a></Button>
                    <Button asChild size="sm" variant="outline"><a href={`/api/export/${k}?formato=xlsx`}><Download aria-hidden /> Excel</a></Button>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Backup e restauração</CardTitle>
            <CardDescription>
              O backup (JSON) contém carteira, operações, cotações, proventos, recebimentos, simulações, metas, configurações e
              auditoria — sem senhas ou sessões. Para o banco inteiro, use também o procedimento com pg_dump (README).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Button asChild className="w-fit" variant="secondary"><a href="/api/backup" download data-testid="backup-download"><Download aria-hidden /> Baixar backup</a></Button>
            <RestoreForm action={restoreBackupAction} />
          </CardContent>
        </Card>
      </div>

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
