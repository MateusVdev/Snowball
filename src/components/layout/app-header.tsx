import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/server/auth/actions";
import type { PublicUser } from "@/server/auth/service";

/** Barra superior da área autenticada (menu lateral + usuário + sair). */
export function AppHeader({ user }: { user: PublicUser }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/75 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-8">
        <span className="pl-11 text-sm font-semibold lg:hidden">Bola de Neve</span>
        <span className="hidden lg:block" />
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline" data-testid="current-user">
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
