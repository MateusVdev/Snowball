import Link from "next/link";
import type { OperationView } from "@/server/services/portfolio/operation-service";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  CalendarDate,
  Money,
  OperationStatusBadge,
  OperationTypeBadge,
  Quantity,
  UnitPrice,
} from "./values";

/** Tabela de operações (histórico). Inativas aparecem riscadas. */
export function OperationsTable({
  operations,
  showFund = true,
}: {
  operations: OperationView[];
  showFund?: boolean;
}) {
  if (operations.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma operação encontrada.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          {showFund ? <TableHead>Fundo</TableHead> : null}
          <TableHead>Tipo</TableHead>
          <TableHead className="text-right">Qtd.</TableHead>
          <TableHead className="text-right">Preço</TableHead>
          <TableHead className="text-right">Taxas</TableHead>
          <TableHead className="text-right">Valor total</TableHead>
          <TableHead className="text-right">PM após</TableHead>
          <TableHead className="text-right">Resultado realizado</TableHead>
          <TableHead>Situação</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {operations.map((op) => {
          const inactive = op.status !== "ACTIVE";
          return (
            <TableRow key={op.id} data-testid={`operation-${op.id}`} className={cn(inactive && "text-muted-foreground")}>
              <TableCell><CalendarDate value={op.tradeDate} empty="Sem data" /></TableCell>
              {showFund ? (
                <TableCell className="font-medium">
                  <Link href={`/carteira/${op.ticker}`} className="hover:underline">{op.ticker}</Link>
                </TableCell>
              ) : null}
              <TableCell><OperationTypeBadge type={op.type} /></TableCell>
              <TableCell className={cn("text-right", inactive && "line-through")}><Quantity value={op.quantity} /></TableCell>
              <TableCell className={cn("text-right", inactive && "line-through")}><UnitPrice value={op.unitPrice} /></TableCell>
              <TableCell className="text-right"><Money value={op.fees} /></TableCell>
              <TableCell className={cn("text-right", inactive && "line-through")}><Money value={op.netAmount} /></TableCell>
              <TableCell className="text-right"><UnitPrice value={op.averagePriceAfter} /></TableCell>
              <TableCell className="text-right">
                {op.type === "SELL" ? <Money value={op.realizedResult} signed /> : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell><OperationStatusBadge status={op.status} /></TableCell>
              <TableCell>
                <Link href={`/operacoes/${op.id}`} className="text-sm underline-offset-4 hover:underline">
                  Detalhes
                </Link>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
