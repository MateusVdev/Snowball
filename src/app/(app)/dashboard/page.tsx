import type { Metadata } from "next";
import Link from "next/link";
import { Calculator, Coins, LineChart } from "lucide-react";
import { PageHeader, Stat } from "@/components/portfolio/page-header";
import { Money, Percent } from "@/components/portfolio/values";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getPortfolio } from "@/server/services/portfolio/fund-service";

export const metadata: Metadata = { title: "Painel" };

/** Módulos ainda não implementados (próximas etapas). */
const upcomingModules = [
  { icon: Coins, title: "Proventos", description: "Registro e acompanhamento de rendimentos distribuídos." },
  { icon: LineChart, title: "Cotações automáticas", description: "Integração com fontes externas de preços e indicadores." },
  { icon: Calculator, title: "Simulador", description: "Projeção de reinvestimento de dividendos (efeito bola de neve)." },
] as const;

export default async function DashboardPage() {
  const user = await requireUser();
  const { positions, totals } = await getPortfolio(getDb(), user.id);
  const open = positions.filter((p) => !p.metrics.quantity.isZero()).length;

  return (
    <div className="grid gap-8">
      <PageHeader
        title={`Olá, ${user.name}`}
        description={`${open} fundo(s) com posição aberta.`}
        actions={
          <Button asChild>
            <Link href="/carteira">Ver carteira</Link>
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo">
        <Stat label="Capital investido"><Money value={totals.investedCapital} /></Stat>
        <Stat label="Valor atual" hint="Cotação atual de cada fundo (manual ou automática)"><Money value={totals.currentValue} /></Stat>
        <Stat label="Resultado não realizado" hint={<Percent value={totals.unrealizedReturn} />}>
          <Money value={totals.unrealizedResult} signed />
        </Stat>
        <Stat label="Resultado realizado"><Money value={totals.realizedResult} signed /></Stat>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {upcomingModules.map(({ icon: Icon, title, description }) => (
          <Card key={title} className="opacity-80">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Icon aria-hidden className="size-5 text-muted-foreground" />
                <CardTitle>{title}</CardTitle>
              </div>
              <CardDescription>{description}</CardDescription>
              <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Em breve</span>
            </CardHeader>
          </Card>
        ))}
      </section>
    </div>
  );
}
