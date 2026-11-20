"use client";

import { useState } from "react";
import { CheckboxField, Field, useActionFormState } from "@/components/forms/action-form";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * Campos do título de renda fixa. Ao escolher LCI/LCA, "Isento de IR" é
 * marcado automaticamente (e desmarcado ao voltar para CDB/RDB/…); o usuário
 * pode alterar. Tesouro Selic seleciona o indexador Selic.
 */
const PRODUCT_OPTIONS = [
  { value: "CDB", label: "CDB / caixinha" },
  { value: "RDB", label: "RDB" },
  { value: "LCI", label: "LCI (isenta de IR)" },
  { value: "LCA", label: "LCA (isenta de IR)" },
  { value: "TESOURO_SELIC", label: "Tesouro Selic" },
  { value: "OUTRO", label: "Outro" },
];
const INDEXER_OPTIONS = [
  { value: "CDI", label: "CDI" },
  { value: "SELIC", label: "Selic" },
];
const exemptByDefault = (type: string) => type === "LCI" || type === "LCA";

export interface AssetDefaults {
  name?: string;
  issuer?: string;
  productType?: string;
  indexer?: string;
  rate?: string;
  spreadAnnualPercent?: string;
  taxExempt?: boolean;
  dailyLiquidity?: boolean;
  maturityDate?: string;
  notes?: string;
}

function FieldError({ name }: { name: string }) {
  const { state } = useActionFormState();
  const errors = state.fieldErrors?.[name];
  return errors ? (
    <p id={`field-${name}-error`} className="text-sm text-destructive">
      {errors[0]}
    </p>
  ) : null;
}

export function AssetFields({ defaults = {} }: { defaults?: AssetDefaults }) {
  const { state } = useActionFormState();
  const v = state.values;
  const [productType, setProductType] = useState(v?.productType ?? defaults.productType ?? "CDB");
  const [indexer, setIndexer] = useState(v?.indexer ?? defaults.indexer ?? "CDI");
  const [taxExempt, setTaxExempt] = useState(
    v ? v.taxExempt === "on" : (defaults.taxExempt ?? exemptByDefault(defaults.productType ?? "CDB")),
  );

  function changeType(next: string) {
    setProductType(next);
    if (exemptByDefault(next) !== exemptByDefault(productType)) setTaxExempt(exemptByDefault(next));
    if (next === "TESOURO_SELIC") setIndexer("SELIC");
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="name" label="Nome" placeholder="Caixinha Turbo" defaultValue={defaults.name} />
      <Field name="issuer" label="Emissor (opcional)" placeholder="Nubank" defaultValue={defaults.issuer} />
      <div className="grid gap-2">
        <Label htmlFor="field-productType">Tipo</Label>
        <NativeSelect
          id="field-productType"
          name="productType"
          value={productType}
          onChange={(e) => changeType(e.target.value)}
          aria-invalid={state.fieldErrors?.productType ? true : undefined}
        >
          {PRODUCT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </NativeSelect>
        <FieldError name="productType" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="field-indexer">Indexador</Label>
        <NativeSelect
          id="field-indexer"
          name="indexer"
          value={indexer}
          onChange={(e) => setIndexer(e.target.value)}
          aria-invalid={state.fieldErrors?.indexer ? true : undefined}
        >
          {INDEXER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </NativeSelect>
        <FieldError name="indexer" />
      </div>
      <Field
        name="rate"
        label={`Rentabilidade (% do ${indexer === "SELIC" ? "Selic" : "CDI"})`}
        inputMode="decimal"
        placeholder="115"
        hint="Ex.: 115 = 115% do CDI"
        defaultValue={defaults.rate}
      />
      <Field
        name="spreadAnnualPercent"
        label="Taxa adicional ao ano (opcional)"
        inputMode="decimal"
        placeholder="0,10"
        hint="Spread/ágio em % a.a. (pode ser negativo). Deixe vazio se não houver."
        defaultValue={defaults.spreadAnnualPercent}
      />
      <Field name="maturityDate" label="Vencimento (opcional)" type="date" defaultValue={defaults.maturityDate} />
      <div className="grid content-end gap-3 pb-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="taxExempt"
            checked={taxExempt}
            onChange={(e) => setTaxExempt(e.target.checked)}
            className="size-4"
            data-testid="tax-exempt"
          />
          Isento de IR
        </label>
        <CheckboxField name="dailyLiquidity" label="Liquidez diária" defaultChecked={defaults.dailyLiquidity ?? true} />
      </div>
      <Field name="notes" label="Observações (opcional)" as="textarea" className="sm:col-span-2" defaultValue={defaults.notes} />
    </div>
  );
}
