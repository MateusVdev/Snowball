import Link from "next/link";
import { LogOut, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/server/auth/actions";
import type { PublicUser } from "@/server/auth/service";

/** Cabeçalho da área autenticada. Recebe apenas os campos públicos do usuário. */
export function AppHeader({ user }: { user: PublicUser }) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-semibold"
          >
            <Snowflake aria-hidden className="size-5" />
            <span className="hidden sm:inline">Bola de Neve</span>
          </Link>
          <nav aria-label="Principal" className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">Painel</Link>
            <Link href="/carteira" className="text-muted-foreground hover:text-foreground">Carteira</Link>
            <Link href="/operacoes" className="text-muted-foreground hover:text-foreground">Operações</Link>
            <Link href="/proventos" className="text-muted-foreground hover:text-foreground">Proventos</Link>
            <Link href="/integracoes" className="text-muted-foreground hover:text-foreground">Integrações</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="hidden text-sm text-muted-foreground sm:inline"
            data-testid="current-user"
          >
            {user.name}
          </span>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm">
              <LogOut aria-hidden />
              Sair
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
