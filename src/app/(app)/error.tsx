"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Erro inesperado em uma página privada: mensagem clara e opção de tentar de novo. */
export default function PrivateError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto grid max-w-lg gap-4 rounded-xl border bg-card p-8 text-center" role="alert">
      <AlertTriangle aria-hidden className="mx-auto size-8 text-negative" />
      <h1 className="text-xl font-semibold">Algo deu errado ao carregar esta página</h1>
      <p className="text-sm text-muted-foreground">
        Nenhum dado foi alterado. Tente novamente; se persistir, verifique a conexão com o banco em Central de dados.
        {error.digest ? <span className="mt-2 block text-xs">Código: {error.digest}</span> : null}
      </p>
      <div><Button onClick={reset}>Tentar novamente</Button></div>
    </div>
  );
}
