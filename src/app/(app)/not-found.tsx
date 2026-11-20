import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto grid max-w-lg gap-4 rounded-xl border bg-card p-8 text-center">
      <h1 className="text-xl font-semibold">Não encontrado</h1>
      <p className="text-sm text-muted-foreground">O registro pedido não existe ou não pertence à sua conta.</p>
      <div><Button asChild><Link href="/dashboard">Voltar à visão geral</Link></Button></div>
    </div>
  );
}
