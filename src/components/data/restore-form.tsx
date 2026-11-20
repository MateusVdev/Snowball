"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/server/actions/form-state";

/** Upload do backup com confirmação explícita. */
export function RestoreForm({ action }: { action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form action={formAction} className="grid gap-3 rounded-lg border border-dashed p-3" data-testid="restore-form">
      <Label htmlFor="backup-file">Restaurar a partir de um backup</Label>
      <Input id="backup-file" name="backup" type="file" accept="application/json,.json" required />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
        Entendo que a restauração só é feita em uma conta sem dados e não apaga nem sobrescreve registros.
      </label>
      {state.error ? (
        <Alert variant="destructive"><AlertCircle aria-hidden /><AlertDescription>{state.error}</AlertDescription></Alert>
      ) : null}
      {state.success ? (
        <Alert><CheckCircle2 aria-hidden /><AlertDescription>{state.success}</AlertDescription></Alert>
      ) : null}
      <div>
        <Button type="submit" variant="outline" disabled={!confirmed || pending}>
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Upload aria-hidden />} Restaurar
        </Button>
      </div>
    </form>
  );
}
