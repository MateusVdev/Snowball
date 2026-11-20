"use client";

import { useState } from "react";
import { SeriesLineChart, type SeriesDef, type ValueFormat } from "@/components/charts/series-line-chart";

/** Gráfico de linhas com seleção das séries exibidas (ex.: cenários/estratégias). */
export function SelectableSeriesChart({
  data,
  series,
  format,
  ariaLabel,
  metrics,
}: {
  data: Record<string, Record<string, number | string | null>[]>;
  series: SeriesDef[];
  format: Record<string, ValueFormat>;
  ariaLabel: string;
  metrics: { key: string; label: string }[];
}) {
  const [visible, setVisible] = useState<string[]>(series.map((s) => s.key));
  const [metric, setMetric] = useState(metrics[0].key);
  const shown = series.filter((s) => visible.includes(s.key));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <fieldset className="flex flex-wrap gap-3">
          <legend className="sr-only">Séries exibidas</legend>
          {series.map((s) => (
            <label key={s.key} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={visible.includes(s.key)}
                onChange={(e) => setVisible((v) => (e.target.checked ? [...v, s.key] : v.filter((k) => k !== s.key)))}
              />
              {s.label}
            </label>
          ))}
        </fieldset>
        <div className="ml-auto flex gap-1" role="group" aria-label="Métrica">
          {metrics.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
              className={`rounded-md border px-2 py-1 text-xs ${metric === m.key ? "border-primary bg-primary/15" : ""}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length ? (
        <SeriesLineChart data={data[metric]} series={shown} format={format[metric]} ariaLabel={ariaLabel} />
      ) : (
        <p className="text-sm text-muted-foreground">Selecione ao menos uma série.</p>
      )}
    </div>
  );
}
