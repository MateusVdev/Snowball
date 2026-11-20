import type { Metadata } from "next";
import { PageHeader } from "@/components/portfolio/page-header";
import { SimulationEditor } from "@/components/simulation/simulation-editor";
import { defaultConfig, defaultFund, example96Config } from "@/domain/simulation";
import { saveSimulationAction } from "@/server/actions/simulation";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { ServiceError } from "@/server/services/errors";
import { buildConfigFromPortfolio, portfolioFundOptions } from "@/server/services/simulation/simulation-service";

export const metadata: Metadata = { title: "Nova simulação" };

export default async function NewSimulationPage({ searchParams }: PageProps<"/simulador/nova">) {
  const user = await requireUser();
  const { origem } = await searchParams;

  let config = defaultConfig({ months: 120, funds: [defaultFund({ key: "F1", ticker: "FUNDO11", initialQuantity: "10" })] });
  let name = "Nova simulação";
  let warnings: string[] = [];
  let origin: "MANUAL" | "PORTFOLIO" = "MANUAL";

  if (origem === "exemplo") {
    config = example96Config(12);
    name = "Exemplo: 96 cotas";
  } else if (origem === "carteira") {
    try {
      const imp = await buildConfigFromPortfolio(getDb(), user.id, 120);
      config = imp.config;
      warnings = imp.warnings;
      name = `Minha carteira (${imp.snapshotDate.split("-").reverse().join("/")})`;
      origin = "PORTFOLIO";
    } catch (error) {
      warnings = [error instanceof ServiceError ? error.message : "Não foi possível importar a carteira."];
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Nova simulação"
        description={origin === "PORTFOLIO" ? "Valores copiados da sua carteira real — edite à vontade; a carteira não é alterada." : "Simulação independente."}
      />
      <SimulationEditor
        action={saveSimulationAction.bind(null, null, origin)}
        initialConfig={config}
        initialName={name}
        initialDescription=""
        warnings={warnings}
        portfolioFunds={await portfolioFundOptions(getDb(), user.id)}
      />
    </div>
  );
}
