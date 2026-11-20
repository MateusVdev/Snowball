import { after } from "next/server";
import { AppHeader } from "@/components/layout/app-header";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getIntegrations } from "@/server/integrations/registry";
import { maybeAutoRefresh } from "@/server/services/market/auto-refresh";

/**
 * Layout da área privada. A verificação real da sessão (no banco) acontece
 * aqui via DAL; o proxy só faz a checagem otimista do cookie.
 * Importante: páginas, Server Actions e Route Handlers privados também devem
 * chamar requireUser()/getCurrentUser() — layouts não protegem actions.
 */
export default async function PrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // Atualização automática em segundo plano (após enviar a resposta), se o
  // intervalo configurado venceu. Nunca bloqueia nem quebra a página.
  after(() => maybeAutoRefresh(getDb(), user.id, getIntegrations()));

  return (
    <div className="app-backdrop flex min-h-screen flex-1 flex-col lg:pl-64">
      <SidebarNav />
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 animate-in fade-in duration-300 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  );
}
