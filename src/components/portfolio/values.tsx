import {
  formatBRL,
  formatPercent,
  formatQuantity,
  formatUnitPrice,
  toDecimal,
  type DecimalInput,
} from "@/domain/money";
import { formatDate, formatDateTime } from "@/domain/dates";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Valores formatados. `null` = dado indisponível (nunca estimado). */

const NA = <span className="text-muted-foreground">—</span>;

function signClass(value: DecimalInput) {
  const d = toDecimal(value);
  if (d.isZero()) return "";
  return d.isPositive() ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400";
}

export function Money({ value, signed = false }: { value: DecimalInput | null; signed?: boolean }) {
  if (value === null) return NA;
  const text = formatBRL(value);
  return (
    <span className={cn("tabular-nums", signed && signClass(value))}>
      {signed && toDecimal(value).isPositive() && !toDecimal(value).isZero() ? "+" : ""}
      {text}
    </span>
  );
}

export function UnitPrice({ value }: { value: DecimalInput | null }) {
  if (value === null) return NA;
  return <span className="tabular-nums">{formatUnitPrice(value)}</span>;
}

export function Percent({ value }: { value: DecimalInput | null }) {
  if (value === null) return NA;
  return (
    <span className={cn("tabular-nums", signClass(value))}>
      {toDecimal(value).isPositive() && !toDecimal(value).isZero() ? "+" : ""}
      {formatPercent(value)}
    </span>
  );
}

export function Quantity({ value }: { value: DecimalInput | null }) {
  if (value === null) return NA;
  return <span className="tabular-nums">{formatQuantity(value)}</span>;
}

export function CalendarDate({ value, empty = "Não informada" }: { value: Date | null; empty?: string }) {
  if (!value) return <span className="text-muted-foreground">{empty}</span>;
  return <span className="tabular-nums">{formatDate(value)}</span>;
}

export function Timestamp({ value }: { value: Date }) {
  return <span className="tabular-nums">{formatDateTime(value)}</span>;
}

export function QuoteSourceBadge({ recordedAt, referenceDate }: { recordedAt: Date; referenceDate: Date | null }) {
  const title = referenceDate
    ? `Cotação manual referente a ${formatDate(referenceDate)}`
    : `Cotação manual registrada em ${formatDateTime(recordedAt)} (data de referência não informada)`;
  return (
    <Badge variant="outline" title={title}>
      Manual
    </Badge>
  );
}

const TYPE_LABEL = {
  INITIAL_BALANCE: "Saldo inicial",
  BUY: "Compra",
  SELL: "Venda",
} as const;

const STATUS_LABEL = {
  ACTIVE: "Ativa",
  CANCELED: "Cancelada",
  SUPERSEDED: "Corrigida",
} as const;

export function OperationTypeBadge({ type }: { type: keyof typeof TYPE_LABEL }) {
  return (
    <Badge variant={type === "SELL" ? "secondary" : type === "BUY" ? "default" : "outline"}>
      {TYPE_LABEL[type]}
    </Badge>
  );
}

export function OperationStatusBadge({ status }: { status: keyof typeof STATUS_LABEL }) {
  if (status === "ACTIVE") return <Badge variant="outline">{STATUS_LABEL[status]}</Badge>;
  return <Badge variant="destructive">{STATUS_LABEL[status]}</Badge>;
}

export const operationTypeLabel = (type: keyof typeof TYPE_LABEL) => TYPE_LABEL[type];
