import { formatBRL, formatPercent } from "@/domain/money";
import type { AllocationSlice } from "@/domain/portfolio/history";

/**
 * Distribuição em barras horizontais (mais legível que pizza): rótulo,
 * percentual e valor sempre visíveis em texto; a barra só reforça.
 */
export function AllocationBars({ slices, empty = "Sem posições." }: { slices: AllocationSlice[]; empty?: string }) {
  if (slices.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid gap-3" aria-label="Distribuição">
      {slices.map((s, i) => (
        <li key={s.key} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium">{s.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatPercent(s.share)} · {formatBRL(s.value)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(1, s.share.times(100).toNumber())}%`, background: `var(--series-${(i % 4) + 1})` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
