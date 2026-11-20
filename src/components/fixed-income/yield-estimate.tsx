import type { ReactNode } from "react";
import { Money } from "@/components/portfolio/values";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isoToBr } from "@/domain/fixed-income/labels";
import { formatPercent, type FinDecimal } from "@/domain/money";

interface Amounts {
  gross: FinDecimal;
  net: FinDecimal;
}

export interface YieldEstimateView {
  available: boolean;
  rateDate: string | null;
  perBusinessDay: Amounts;
  monthToDate: Amounts;
  monthProjection: Amounts;
  remainingBusinessDays?: number;
  incomeTaxRate?: FinDecimal;
}

/** Texto fixo deixando claro que são estimativas. */
export function yieldEstimateNote(e: Pick<YieldEstimateView, "available" | "rateDate">) {
  return e.available && e.rateDate
    ? `Estimativa com base na última taxa do CDI/Selic (${isoToBr(e.rateDate)}) e no saldo atual. Não inclui IOF nem aportes/resgates futuros.`
    : "Ainda não há taxa do CDI/Selic guardada: não é possível estimar o rendimento diário nem a projeção do mês.";
}

/** "Quanto rende" — por dia útil, mês até hoje e projeção do mês (bruto e líquido de IR). */
export function YieldEstimateCard({
  estimate,
  title = "Quanto rende (estimativa)",
  children,
  testId = "yield-estimate",
}: {
  estimate: YieldEstimateView;
  title?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  const NA = <span className="text-muted-foreground">—</span>;
  const rows: { label: string; hint?: string; v: Amounts; needsRate: boolean; testId: string }[] = [
    { label: "Por dia útil", hint: "Saldo atual × última taxa", v: estimate.perBusinessDay, needsRate: true, testId: "yield-day" },
    { label: "No mês até hoje", v: estimate.monthToDate, needsRate: false, testId: "yield-month" },
    {
      label: "Projeção do mês inteiro",
      hint: estimate.remainingBusinessDays !== undefined ? `Até hoje + ${estimate.remainingBusinessDays} dia(s) útil(eis) restante(s)` : "Até hoje + dias úteis restantes",
      v: estimate.monthProjection,
      needsRate: true,
      testId: "yield-projection",
    },
  ];
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {yieldEstimateNote(estimate)}
          {estimate.incomeTaxRate && estimate.available
            ? ` Líquido de IR com alíquota média de ${formatPercent(estimate.incomeTaxRate)} (aportes ainda investidos).`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {children}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rendimento</TableHead>
              <TableHead className="text-right">Bruto</TableHead>
              <TableHead className="text-right">Líquido de IR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const show = estimate.available || !r.needsRate;
              return (
                <TableRow key={r.label} data-testid={r.testId}>
                  <TableCell>
                    {r.label}
                    {r.hint ? <div className="text-xs text-muted-foreground">{r.hint}</div> : null}
                  </TableCell>
                  <TableCell className="text-right">{show ? <Money value={r.v.gross} /> : NA}</TableCell>
                  <TableCell className="text-right">{show ? <Money value={r.v.net} /> : NA}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
