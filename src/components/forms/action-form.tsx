"use client";

import { createContext, useActionState, useContext, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/server/actions/form-state";
import { cn } from "@/lib/utils";

/**
 * Formulário genérico para Server Actions com useActionState.
 * Mostra erro geral, erros por campo e preserva os valores digitados quando
 * a action devolve erro (o React 19 reseta o formulário após o envio).
 */
type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const FormContext = createContext<{ state: FormState; pending: boolean }>({
  state: {},
  pending: false,
});

export function ActionForm({
  action,
  submitLabel,
  submitVariant = "default",
  children,
  className,
  testId,
}: {
  action: Action;
  submitLabel: string;
  submitVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost";
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <FormContext value={{ state, pending }}>
      <form action={formAction} className={cn("grid gap-4", className)} noValidate data-testid={testId}>
        {state.success ? (
          <Alert data-testid="form-success">
            <CheckCircle2 aria-hidden />
            <AlertDescription>
              <p>{state.success}</p>
              {state.details?.length ? (
                <ul className="list-disc pl-4 text-xs">
                  {state.details.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {state.error ? (
          <Alert variant="destructive" data-testid="form-error">
            <AlertCircle aria-hidden />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        {/* key: remonta os campos a cada resposta para aplicar os valores preservados */}
        <div key={state.ts ?? 0} className="grid gap-4">
          {children}
        </div>
        <div>
          <Button type="submit" variant={submitVariant} disabled={pending}>
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {submitLabel}
          </Button>
        </div>
      </form>
    </FormContext>
  );
}

type FieldProps = {
  name: string;
  label: string;
  defaultValue?: string;
  hint?: string;
  className?: string;
} & (
  | { as?: "input"; type?: string; inputMode?: "decimal" | "numeric" | "text"; placeholder?: string; required?: boolean; max?: string; list?: string }
  | { as: "textarea"; placeholder?: string }
  | { as: "select"; options: { value: string; label: string }[] }
);

export function Field(props: FieldProps) {
  const { state } = useContext(FormContext);
  const { name, label, hint, className } = props;
  const errors = state.fieldErrors?.[name];
  const value = state.values?.[name] ?? props.defaultValue ?? "";
  const id = `field-${name}`;
  const describedBy = errors ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const common = {
    id,
    name,
    defaultValue: value,
    "aria-invalid": errors ? true : undefined,
    "aria-describedby": describedBy,
  };

  let control: ReactNode;
  if (props.as === "textarea") {
    control = <Textarea {...common} placeholder={props.placeholder} />;
  } else if (props.as === "select") {
    control = (
      <NativeSelect {...common}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    );
  } else {
    control = (
      <Input
        {...common}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        required={props.required}
        max={props.max}
        list={props.list}
        autoComplete="off"
      />
    );
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {control}
      {errors ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {errors[0]}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Campo oculto (ex.: ids). */
export function HiddenField({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

/** Checkbox que preserva o estado após erro de validação. */
export function CheckboxField({
  name,
  label,
  defaultChecked = false,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  const { state } = useContext(FormContext);
  const checked = state.values ? state.values[name] === "on" : defaultChecked;
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <input type="checkbox" name={name} defaultChecked={checked} className="size-4" />
      {label}
    </label>
  );
}

/** Mensagem auxiliar dentro do formulário. */
export function FormNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
