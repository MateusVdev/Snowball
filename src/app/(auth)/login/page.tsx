import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Snowflake } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/server/auth/dal";
import { safeRedirectPath } from "@/server/auth/redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; senha?: string }>;
}) {
  const { next, senha } = await searchParams;
  const nextPath = safeRedirectPath(Array.isArray(next) ? next[0] : next);

  // Já autenticado (sessão válida no banco): não mostra o formulário.
  if (await getCurrentUser()) {
    redirect(nextPath);
  }

  return (
    <main className="app-backdrop flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Snowflake aria-hidden className="size-6" />
          </div>
          <CardTitle className="text-2xl">Bola de Neve</CardTitle>
          <CardDescription>Acesse sua carteira de FIIs</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {senha === "alterada" ? (
            <p role="status" className="rounded-md border border-positive/40 bg-positive/10 px-3 py-2 text-sm">
              Senha alterada. Entre novamente com a nova senha.
            </p>
          ) : null}
          <LoginForm nextPath={nextPath} />
        </CardContent>
      </Card>
    </main>
  );
}
