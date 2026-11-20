"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Gráfico de linhas genérico (1 a 4 séries). Linhas de 2px, grade discreta,
 * crosshair + tooltip com todas as séries. Com ≥ 2 séries há legenda (a cor
 * nunca é a única identificação). Cores: paleta validada (--series-1..4).
 * Os valores exatos estão sempre também em tabela na página.
 */
export interface SeriesDef {
  key: string;
  label: string;
}

export type ValueFormat = "brl" | "int";

const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

function fmt(value: number, format: ValueFormat, compact = false) {
  if (format === "int") return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  });
}

export function SeriesLineChart({
  data,
  series,
  format,
  ariaLabel,
  height = 240,
}: {
  data: Record<string, number | string>[];
  series: SeriesDef[];
  format: ValueFormat;
  ariaLabel: string;
  height?: number;
}) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">Sem dados.</p>;
  return (
    <div className="grid gap-2">
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ background: COLORS[i] }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div style={{ height }} className="w-full" role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={72}
              domain={["auto", "auto"]}
              allowDecimals={format !== "int"}
              tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
              tickFormatter={(v: number) => fmt(v, format, true)}
            />
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm">
                    <div className="mb-1 text-muted-foreground">{label}</div>
                    {series.map((s, i) => {
                      const item = payload.find((p) => p.dataKey === s.key);
                      if (!item) return null;
                      return (
                        <div key={s.key} className="flex items-center justify-between gap-4">
                          <span className="flex items-center gap-1.5">
                            <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: COLORS[i] }} />
                            {s.label}
                          </span>
                          <span className="font-medium tabular-nums">{fmt(Number(item.value), format)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                stroke={COLORS[i]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
