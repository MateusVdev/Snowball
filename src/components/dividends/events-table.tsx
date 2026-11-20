import Link from "next/link";
import type { DividendEventView } from "@/server/services/dividends/dividend-service";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarDate, Money, Quantity, UnitPrice } from "@/components/portfolio/values";
import { DataSourceBadge, DividendStatusBadge, ReceivedBadge, dividendTypeLabel } from "./badges";

/** Tabela de proventos: valor por cota, datas, elegibilidade, valor esperado e status. */
export function DividendEventsTable({ events, showFund = true }: { events: DividendEventView[]; showFund?: boolean }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum provento registrado.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showFund ? <TableHead>Fundo</TableHead> : null}
          <TableHead>Tipo</TableHead>
          <TableHead className="text-right">Valor/cota</TableHead>
          <TableHead>Data-com</TableHead>
          <TableHead>Pagamento</TableHead>
          <TableHead>Competência</TableHead>
          <TableHead className="text-right">Cotas elegíveis</TableHead>
          <TableHead className="text-right">Valor total</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Fonte</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => (
          <TableRow key={e.id} data-testid={`dividend-${e.ticker}-${e.dataCom.toISOString().slice(0, 10)}`}>
            {showFund ? (
              <TableCell className="font-medium">
                <Link className="hover:underline" href={`/carteira/${e.ticker}`}>{e.ticker}</Link>
              </TableCell>
            ) : null}
            <TableCell>{dividendTypeLabel(e.type)}</TableCell>
            <TableCell className="text-right"><UnitPrice value={e.ratePerShare} /></TableCell>
            <TableCell><CalendarDate value={e.dataCom} /></TableCell>
            <TableCell><CalendarDate value={e.paymentDate} empty="A definir" /></TableCell>
            <TableCell>{e.competence ?? e.referenceLabel ?? <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell className="text-right">
              {e.receipt ? (
                <Quantity value={e.receipt.eligibleQuantity} />
              ) : e.eligibility.status === "KNOWN" ? (
                <Quantity value={e.eligibility.quantity} />
              ) : (
                <span className="text-muted-foreground" title={e.eligibility.reason}>Desconhecida</span>
              )}
            </TableCell>
            <TableCell className="text-right">
              {e.receipt ? <Money value={e.receipt.totalAmount} /> : <Money value={e.expectedAmount} />}
            </TableCell>
            <TableCell className="space-x-1">
              <DividendStatusBadge status={e.status} />
              {e.receipt ? <ReceivedBadge /> : null}
            </TableCell>
            <TableCell><DataSourceBadge source={e.source} verified={e.verified} /></TableCell>
            <TableCell>
              <Link href={`/proventos/${e.id}`} className="text-sm underline-offset-4 hover:underline">Detalhes</Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
