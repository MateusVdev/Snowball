"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Renda mensal recebida (série única → sem legenda; o título nomeia a série).
 * Barras ≤ 24px, topo arredondado (4px) e base reta; grade discreta; tooltip
 * por barra. Os mesmos dados aparecem em tabela na página.
 */
export interface MonthlyIncomePoint {
  month: string; // AAAA-MM
  label: string; // "out/26"
  total: number; // apenas para desenhar; os valores exibidos vêm formatados
  formatted: string;
}

export function MonthlyIncomeChart({ data }: { data: MonthlyIncomePoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem recebimentos registrados.</p>;
  }
  return (
    <div className="h-64 w-full" role="img" aria-label="Gráfico de barras da renda mensal recebida">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={64}
            tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
            tickFormatter={(v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) => {
              const p = active && payload?.[0] ? (payload[0].payload as MonthlyIncomePoint) : null;
              if (!p) return null;
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm">
                  <div className="text-muted-foreground">{p.label}</div>
                  <div className="font-medium tabular-nums">{p.formatted}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="total" fill="var(--series-1)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
