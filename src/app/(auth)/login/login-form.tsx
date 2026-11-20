"use client";

import { useActionState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginFormState } from "@/server/auth/actions";

const initialState: LoginFormState = {};

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState(
    loginAction,
    initialState,
  );

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={nextPath} />

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
        />
        {state.fieldErrors?.email ? (
          <p id="email-error" className="text-sm text-destructive">
            {state.fieldErrors.email[0]}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={
            state.fieldErrors?.password ? "password-error" : undefined
          }
        />
        {state.fieldErrors?.password ? (
          <p id="password-error" className="text-sm text-destructive">
            {state.fieldErrors.password[0]}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
        Entrar
      </Button>
    </form>
  );
}
