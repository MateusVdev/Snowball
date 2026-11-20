import type { Metadata } from "next";
import { ActionForm, CheckboxField, Field, FormNote } from "@/components/forms/action-form";
import { PageHeader } from "@/components/portfolio/page-header";
import { Timestamp } from "@/components/portfolio/values";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateSettingsAction } from "@/server/actions/market";
import { changePasswordAction, revokeOtherSessionsAction, updateProfileAction } from "@/server/actions/settings";
import { requireUser } from "@/server/auth/dal";
import { listUserSessions } from "@/server/auth/service";
import { readSessionToken } from "@/server/auth/session";
import { hashSessionToken } from "@/server/auth/tokens";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { getUserSettings } from "@/server/services/market/auto-refresh";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const user = await requireUser();
  const db = getDb();
  const [settings, sessions, token] = await Promise.all([getUserSettings(db, user.id), listUserSessions(db, user.id), readSessionToken()]);
  const currentHash = token ? hashSessionToken(token) : null;

  return (
    <div className="grid gap-6">
      <PageHeader title="Configurações" description="Conta, segurança e atualizações automáticas." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Perfil</CardTitle><CardDescription>E-mail de acesso: {user.email}</CardDescription></CardHeader>
          <CardContent>
            <ActionForm action={updateProfileAction} submitLabel="Salvar perfil" testId="profile-form">
              <Field name="name" label="Nome" defaultValue={user.name} />
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trocar senha</CardTitle>
            <CardDescription>Mínimo de 12 caracteres, com letras e números. Todas as sessões serão encerradas e você entrará novamente.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={changePasswordAction} submitLabel="Trocar senha" testId="password-form">
              <Field name="currentPassword" label="Senha atual" type="password" />
              <Field name="newPassword" label="Nova senha" type="password" />
              <Field name="confirmPassword" label="Confirme a nova senha" type="password" />
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Atualização automática</CardTitle>
            <CardDescription>Roda em segundo plano ao abrir as páginas, quando o intervalo vence (contado da última tentativa).</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={updateSettingsAction} submitLabel="Salvar" testId="settings-form">
              <CheckboxField name="autoUpdateEnabled" label="Ativar atualização automática" defaultChecked={settings.autoUpdateEnabled} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="quoteRefreshMinutes" label="Cotações: a cada (minutos)" type="number" defaultValue={String(settings.quoteRefreshMinutes)} hint="Mínimo 15 (o plano gratuito da brapi atualiza a cada 30 min)" />
                <Field name="dividendRefreshHours" label="Proventos: a cada (horas)" type="number" defaultValue={String(settings.dividendRefreshHours)} hint="Mínimo 1" />
              </div>
              <FormNote>Integrações {getEnv().INTEGRATIONS_ENABLED ? "habilitadas" : "desabilitadas (INTEGRATIONS_ENABLED=false)"} no servidor.</FormNote>
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessões ativas</CardTitle>
            <CardDescription>Sessões expiram em {getEnv().SESSION_TTL_HOURS} h. Encerre as que não reconhecer.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ul className="grid gap-2 text-sm">
              {sessions.map((s) => (
                <li key={s.id} className="grid gap-0.5 border-b pb-2 last:border-0">
                  <span className="flex items-center gap-2">
                    {s.tokenHash === currentHash ? <Badge>Esta sessão</Badge> : <Badge variant="outline">Outra sessão</Badge>}
                    <span className="truncate text-muted-foreground">{s.userAgent?.slice(0, 80) ?? "navegador desconhecido"}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Início <Timestamp value={s.createdAt} /> · último uso <Timestamp value={s.lastUsedAt} /> · expira <Timestamp value={s.expiresAt} />
                    {s.ipAddress ? ` · IP ${s.ipAddress}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <ActionForm action={revokeOtherSessionsAction} submitLabel="Encerrar outras sessões" submitVariant="outline">
              <span className="sr-only">Encerrar todas as outras sessões</span>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
