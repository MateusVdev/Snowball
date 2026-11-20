import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/portfolio/page-header";
import { OperationsTable } from "@/components/portfolio/operations-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toIsoDate } from "@/domain/dates";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { listFundOptions } from "@/server/services/portfolio/fund-service";
import { listOperations } from "@/server/services/portfolio/operation-service";

export const metadata: Metadata = { title: "Operações" };

export default async function OperationsPage({ searchParams }: PageProps<"/operacoes">) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const db = getDb();
  const [{ filter, operations }, funds] = await Promise.all([
    listOperations(db, user.id, {
      fund: one(params.fundo),
      from: one(params.de),
      to: one(params.ate),
      type: one(params.tipo),
      status: one(params.status),
    }),
    listFundOptions(db, user.id),
  ]);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Histórico de operações"
        description="Operações nunca são apagadas: cancelamentos e correções ficam registrados com motivo."
        actions={
          <Button asChild>
            <Link href="/operacoes/nova"><Plus aria-hidden /> Registrar operação</Link>
          </Button>
        }
      />

      <form action="/operacoes" className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3 lg:grid-cols-6 lg:items-end" aria-label="Filtros">
        <div className="grid gap-2">
          <Label htmlFor="f-fundo">Fundo</Label>
          <NativeSelect id="f-fundo" name="fundo" defaultValue={filter.fund ?? ""}>
            <option value="">Todos</option>
            {funds.map((f) => (
              <option key={f.id} value={f.ticker}>{f.ticker}{f.archivedAt ? " (arquivado)" : ""}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="f-de">De</Label>
          <Input id="f-de" type="date" name="de" defaultValue={filter.from ? toIsoDate(filter.from) : ""} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="f-ate">Até</Label>
          <Input id="f-ate" type="date" name="ate" defaultValue={filter.to ? toIsoDate(filter.to) : ""} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="f-tipo">Tipo</Label>
          <NativeSelect id="f-tipo" name="tipo" defaultValue={filter.type ?? ""}>
            <option value="">Todos</option>
            <option value="BUY">Compra</option>
            <option value="SELL">Venda</option>
            <option value="INITIAL_BALANCE">Saldo inicial</option>
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="f-status">Situação</Label>
          <NativeSelect id="f-status" name="status" defaultValue={filter.status ?? "active"}>
            <option value="active">Somente ativas</option>
            <option value="all">Incluir canceladas/corrigidas</option>
          </NativeSelect>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">Filtrar</Button>
          <Button asChild variant="ghost"><Link href="/operacoes">Limpar</Link></Button>
        </div>
      </form>
      {filter.from || filter.to ? (
        <p className="text-xs text-muted-foreground">
          Com filtro de período, saldos iniciais (sem data) não são exibidos.
        </p>
      ) : null}

      <div className="rounded-lg border p-2">
        <OperationsTable operations={operations} />
      </div>
      <p className="text-sm text-muted-foreground">{operations.length} operação(ões).</p>
    </div>
  );
}
