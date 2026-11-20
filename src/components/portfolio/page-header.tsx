import { InfoTip } from "@/components/ui/info-tip";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, children, hint, info }: { label: string; children: ReactNode; hint?: ReactNode; info?: ReactNode }) {
  return (
    <div className="card-elevated rounded-xl border bg-card p-4" data-stat={label}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {info ? <InfoTip label={`Sobre: ${label}`}>{info}</InfoTip> : null}
      </div>
      <div className="mt-1.5 text-xl font-semibold tracking-tight">{children}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
