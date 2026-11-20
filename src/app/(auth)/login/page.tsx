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
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const nextPath = safeRedirectPath(Array.isArray(next) ? next[0] : next);

  // Já autenticado (sessão válida no banco): não mostra o formulário.
  if (await getCurrentUser()) {
    redirect(nextPath);
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Snowflake aria-hidden className="size-6" />
          </div>
          <CardTitle className="text-2xl">Bola de Neve</CardTitle>
          <CardDescription>Acesse sua carteira de FIIs</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm nextPath={nextPath} />
        </CardContent>
      </Card>
    </main>
  );
}
