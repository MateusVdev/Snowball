import { formatBRL, formatPercent, formatQuantity } from "@/domain/money";
import type { GoalStatus } from "@/server/services/goals/goal-service";

export function formatGoalValue(metric: GoalStatus["metric"], v: { toFixed(): string } | null) {
  if (v === null) return "—";
  return metric === "TOTAL_SHARES" ? `${formatQuantity(v.toFixed())} cotas` : formatBRL(v.toFixed());
}

/** Barra de progresso de uma meta (com texto acessível). */
export function GoalProgressBar({ goal }: { goal: GoalStatus }) {
  const pct = goal.fraction ? goal.fraction.times(100).toNumber() : 0;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{goal.name}</span>
        <span className="tabular-nums text-muted-foreground">{goal.fraction ? formatPercent(goal.fraction) : "—"}</span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`Progresso de ${goal.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 ${goal.reached ? "bg-positive" : "bg-gradient-to-r from-[oklch(0.55_0.2_300)] to-primary"}`}
          style={{ width: `${Math.max(goal.fraction ? 2 : 0, pct)}%` }}
        />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{formatGoalValue(goal.metric, goal.current)} de {formatGoalValue(goal.metric, goal.target)}</span>
        <span>{goal.reached ? "Meta atingida" : `Faltam ${formatGoalValue(goal.metric, goal.remaining)}`}</span>
      </div>
    </div>
  );
}
