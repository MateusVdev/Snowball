import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/portfolio/page-header";
import { Money, Timestamp } from "@/components/portfolio/values";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { listSimulations } from "@/server/services/simulation/simulation-service";

export const metadata: Metadata = { title: "Simulador" };

export default async function SimulatorPage() {
  const user = await requireUser();
  const sims = await listSimulations(getDb(), user.id);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Simulador Bola de Neve"
        description="Como os dividendos reinvestidos compram novas cotas, que geram novos dividendos."
        actions={
          <>
            <Button asChild variant="outline"><Link href="/renda-fixa/simulador">Simular renda fixa</Link></Button>
            <Button asChild variant="outline"><Link href="/simulador/nova?origem=exemplo">Exemplo: 96 cotas</Link></Button>
            <Button asChild variant="outline"><Link href="/simulador/nova?origem=carteira">Importar minha carteira</Link></Button>
            <Button asChild><Link href="/simulador/nova"><Plus aria-hidden /> Nova simulação</Link></Button>
          </>
        }
      />
      <Alert>
        <AlertDescription>
          Todas as simulações são <strong>hipotéticas</strong>: dependem das premissas que você define, não garantem dividendos nem preços
          e <strong>nunca alteram a sua carteira real</strong> (a importação copia os valores do dia).
        </AlertDescription>
      </Alert>

      {sims.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Nenhuma simulação salva.</div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Prazo</TableHead>
                <TableHead className="text-right">Cotas finais</TableHead>
                <TableHead className="text-right">Renda mensal final</TableHead>
                <TableHead className="text-right">Patrimônio final</TableHead>
                <TableHead>Atualizada</TableHead>
                <TableHead className="text-right">Versões</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sims.map((s) => {
                const sum = (s.summary ?? {}) as Record<string, string | number>;
                return (
                  <TableRow key={s.id} data-testid="simulation-row">
                    <TableCell className="font-medium"><Link className="hover:underline" href={`/simulador/${s.id}`}>{s.name}</Link></TableCell>
                    <TableCell><Badge variant="outline">{s.origin === "PORTFOLIO" ? "Cópia da carteira" : "Independente"}</Badge></TableCell>
                    <TableCell className="text-right">{sum.months} meses</TableCell>
                    <TableCell className="text-right tabular-nums">{sum.finalShares}</TableCell>
                    <TableCell className="text-right"><Money value={(sum.finalMonthlyIncome as string) ?? null} /></TableCell>
                    <TableCell className="text-right"><Money value={(sum.finalPatrimony as string) ?? null} /></TableCell>
                    <TableCell><Timestamp value={s.updatedAt} /></TableCell>
                    <TableCell className="text-right">{s._count.versions}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
