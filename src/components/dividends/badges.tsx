import { Badge } from "@/components/ui/badge";

const STATUS = {
  ANNOUNCED: { label: "Anunciado", variant: "default", title: "Anúncio oficial; pagamento futuro ou sem data definida." },
  PAID: { label: "Pago pelo fundo", variant: "secondary", title: "Anúncio oficial com data de pagamento já ocorrida." },
  FORECAST: { label: "Previsto (estimativa)", variant: "outline", title: "Estimativa sua. Não é anúncio oficial." },
} as const;

export function DividendStatusBadge({ status }: { status: keyof typeof STATUS }) {
  const s = STATUS[status];
  return <Badge variant={s.variant} title={s.title}>{s.label}</Badge>;
}

export function ReceivedBadge() {
  return <Badge variant="default" className="bg-emerald-700 text-white" title="Recebimento registrado por você">Recebido e registrado</Badge>;
}

const SOURCE = {
  MANUAL: "Manual",
  BRAPI: "brapi",
  B3_FUNDOSNET: "B3 FundosNET (oficial)",
} as const;

export function DataSourceBadge({ source, verified }: { source: keyof typeof SOURCE; verified?: boolean | null }) {
  return (
    <Badge variant="outline" title={verified === false ? "A fonte indica que ainda não foi conferido em documento publicado." : undefined}>
      {SOURCE[source]}
      {verified === false ? " · não conferido" : ""}
    </Badge>
  );
}

export const dividendTypeLabel = (t: "INCOME" | "AMORTIZATION") => (t === "INCOME" ? "Rendimento" : "Amortização");
