import type { Metadata } from "next";
import { Building2, Calculator, Coins, LineChart } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Painel" };

/**
 * Painel inicial (Etapa 1). Não exibe nenhum dado financeiro: os módulos
 * abaixo serão implementados nas próximas etapas.
 */
const upcomingModules = [
  {
    icon: Building2,
    title: "Carteira de FIIs",
    description: "Cadastro de fundos, operações de compra e venda e preço médio.",
  },
  {
    icon: Coins,
    title: "Proventos",
    description: "Registro e acompanhamento de rendimentos distribuídos.",
  },
  {
    icon: LineChart,
    title: "Cotações",
    description: "Integração com fontes externas de preços e indicadores.",
  },
  {
    icon: Calculator,
    title: "Simulador",
    description: "Projeção de reinvestimento de dividendos (efeito bola de neve).",
  },
] as const;

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="grid gap-8">
      <section className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá, {user.name}
        </h1>
        <p className="text-muted-foreground">
          A fundação da plataforma está pronta. Os módulos abaixo serão
          liberados nas próximas etapas.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {upcomingModules.map(({ icon: Icon, title, description }) => (
          <Card key={title} className="opacity-80">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Icon aria-hidden className="size-5 text-muted-foreground" />
                <CardTitle>{title}</CardTitle>
              </div>
              <CardDescription>{description}</CardDescription>
              <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                Em breve
              </span>
            </CardHeader>
          </Card>
        ))}
      </section>
    </div>
  );
}
