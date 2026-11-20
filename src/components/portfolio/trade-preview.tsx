"use client";

import { useEffect, useRef, useState } from "react";
import { formatBRL, parseDecimalInput } from "@/domain/money";
import { operationAmounts } from "@/domain/portfolio/ledger";

/**
 * Prévia do valor total enquanto o usuário digita. Usa o mesmo cálculo do
 * servidor (domínio puro). É apenas informativa: o valor gravado é sempre
 * recalculado no servidor.
 */
export function TradePreview({ fixedType }: { fixedType?: "BUY" | "SELL" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => {
      const get = (name: string) =>
        (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
      const type = (fixedType ?? get("type")) as "BUY" | "SELL";
      const quantity = parseDecimalInput(get("quantity"));
      const price = parseDecimalInput(get("unitPrice"));
      const fees = parseDecimalInput(get("fees") || "0");
      if (!quantity || !price || fees === null || (type !== "BUY" && type !== "SELL")) {
        setText(null);
        return;
      }
      try {
        const { grossAmount, netAmount } = operationAmounts(type, quantity, price, fees);
        setText(
          `Valor bruto ${formatBRL(grossAmount)} · ${type === "BUY" ? "total a pagar" : "valor líquido a receber"} ${formatBRL(netAmount)}`,
        );
      } catch {
        setText(null);
      }
    };
    update();
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
  }, [fixedType]);

  return (
    <div ref={ref} className="rounded-md bg-muted px-3 py-2 text-sm" aria-live="polite" data-testid="trade-preview">
      {text ?? "Preencha quantidade e preço para ver o valor total."}
    </div>
  );
}
