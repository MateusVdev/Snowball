import { AppHeader } from "@/components/layout/app-header";
import { requireUser } from "@/server/auth/dal";

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

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
