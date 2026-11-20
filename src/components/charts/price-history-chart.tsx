"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Fechamentos diários (série única, linha de 2px, crosshair + tooltip). */
export interface PricePoint {
  label: string; // "18/11"
  close: number;
  formatted: string;
}

export function PriceHistoryChart({ data }: { data: PricePoint[] }) {
  if (data.length < 2) {
    return <p className="text-sm text-muted-foreground">Histórico de preços indisponível.</p>;
  }
  return (
    <div className="h-56 w-full" role="img" aria-label="Gráfico de linha dos fechamentos diários">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} />
          <YAxis
            domain={["auto", "auto"]}
            tickLine={false}
            axisLine={false}
            width={64}
            tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
            tickFormatter={(v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const p = active && payload?.[0] ? (payload[0].payload as PricePoint) : null;
              if (!p) return null;
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm">
                  <div className="text-muted-foreground">{p.label}</div>
                  <div className="font-medium tabular-nums">{p.formatted}</div>
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="close" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
