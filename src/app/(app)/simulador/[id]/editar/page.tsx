import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/portfolio/page-header";
import { SimulationEditor } from "@/components/simulation/simulation-editor";
import { saveSimulationAction } from "@/server/actions/simulation";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getSimulation, portfolioFundOptions } from "@/server/services/simulation/simulation-service";

export const metadata: Metadata = { title: "Editar simulação" };

export default async function EditSimulationPage({ params }: PageProps<"/simulador/[id]/editar">) {
  const user = await requireUser();
  const { id } = await params;
  const sim = await getSimulation(getDb(), user.id, id);
  if (!sim) notFound();
  return (
    <div className="grid gap-6">
      <PageHeader title={`Editar: ${sim.name}`} description={<Link className="underline" href={`/simulador/${sim.id}`}>Voltar aos resultados</Link>} />
      <SimulationEditor
        action={saveSimulationAction.bind(null, sim.id, sim.origin)}
        initialConfig={sim.config}
        initialName={sim.name}
        initialDescription={sim.description ?? ""}
        portfolioFunds={await portfolioFundOptions(getDb(), user.id)}
      />
    </div>
  );
}
