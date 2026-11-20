import { FinDecimal, toDecimal, type DecimalInput } from "@/domain/money";

/**
 * Patrimônio por classe de ativo. Novas classes (ex.: ações) entram apenas
 * acrescentando um item em ASSET_CLASSES e informando o valor no serviço da
 * visão geral — o total e a divisão são calculados aqui.
 */
export const ASSET_CLASSES = [
  { key: "FII", label: "FIIs", href: "/carteira" },
  { key: "FIXED_INCOME", label: "Renda fixa", href: "/renda-fixa" },
  { key: "STOCKS", label: "Ações", href: null },
] as const;

export type AssetClassKey = (typeof ASSET_CLASSES)[number]["key"];

export interface AssetClassInput {
  key: AssetClassKey;
  /** Valor atual da classe. null = desconhecido (ex.: fundo sem cotação). */
  value: DecimalInput | null;
  /** Observação exibida (ex.: "valor bruto estimado"). */
  note?: string;
}

export interface AssetClassSlice {
  key: AssetClassKey;
  label: string;
  href: string | null;
  value: FinDecimal | null;
  /** Participação no total (null quando o total é desconhecido). */
  share: FinDecimal | null;
  note: string | null;
}

export interface PatrimonyByClass {
  /** Soma das classes; null se alguma classe com posição tem valor desconhecido. */
  total: FinDecimal | null;
  /** Soma das classes com valor conhecido. */
  knownTotal: FinDecimal;
  /** Somente classes informadas e com valor ≠ 0 ou desconhecido, na ordem de ASSET_CLASSES. */
  classes: AssetClassSlice[];
}

export function patrimonyByClass(inputs: readonly AssetClassInput[]): PatrimonyByClass {
  const byKey = new Map(inputs.map((i) => [i.key, i]));
  const present = ASSET_CLASSES.flatMap((c) => {
    const input = byKey.get(c.key);
    if (!input) return [];
    const value = input.value === null ? null : toDecimal(input.value);
    if (value !== null && value.isZero()) return [];
    return [{ ...c, value, note: input.note ?? null }];
  });
  const knownTotal = present.reduce((acc, c) => (c.value ? acc.plus(c.value) : acc), new FinDecimal(0));
  const total = present.some((c) => c.value === null) ? null : knownTotal;
  return {
    total,
    knownTotal,
    classes: present.map((c) => ({
      key: c.key,
      label: c.label,
      href: c.href,
      value: c.value,
      note: c.note,
      share: total && total.gt(0) && c.value ? c.value.dividedBy(total) : null,
    })),
  };
}
