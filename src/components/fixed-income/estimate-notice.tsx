import { Info } from "lucide-react";
import { isoToBr } from "@/domain/fixed-income/labels";

/** Aviso fixo: todos os valores de renda fixa são estimativas. */
export function EstimateNotice({ ratesKnownUntil, projected = false }: { ratesKnownUntil?: string | null; projected?: boolean }) {
  return (
    <div className="flex gap-3 rounded-lg border bg-card px-4 py-3 text-sm" data-testid="fixed-income-notice">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="grid gap-1">
        <p>
          Valores estimados com base no CDI/Selic oficial do Banco Central. O valor exato pode variar no app do banco.
        </p>
        {ratesKnownUntil !== undefined ? (
          <p className="text-muted-foreground">
            {ratesKnownUntil
              ? `Índices atualizados até ${isoToBr(ratesKnownUntil)}.`
              : "Ainda não há índices do Banco Central guardados: os valores não incluem rendimento."}
            {projected && ratesKnownUntil ? " Os dias seguintes usam a última taxa conhecida (projeção)." : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
