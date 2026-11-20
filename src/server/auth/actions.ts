"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { z } from "zod";
import { loginSchema } from "@/validation/auth";
import { LOGIN_PATH } from "./constants";
import { safeRedirectPath } from "./redirect";
import { login, revokeSession } from "./service";
import {
  clearSessionCookie,
  getRequestMeta,
  readSessionToken,
  setSessionCookie,
} from "./session";

export interface LoginFormState {
  error?: string;
  fieldErrors?: { email?: string[]; password?: string[] };
  email?: string;
}

const GENERIC_ERROR = "E-mail ou senha inválidos.";

export async function loginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const rawEmail = formData.get("email");
  const parsed = loginSchema.safeParse({
    email: rawEmail,
    password: formData.get("password"),
  });
  const email = typeof rawEmail === "string" ? rawEmail.slice(0, 254) : "";

  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return {
      fieldErrors: {
        email: fieldErrors.email,
        password: fieldErrors.password,
      },
      email,
    };
  }

  let result;
  try {
    result = await login(getDb(), parsed.data, {
      ttlHours: getEnv().SESSION_TTL_HOURS,
      meta: await getRequestMeta(),
    });
  } catch (error) {
    console.error("[auth] falha inesperada no login", error);
    return { error: "Não foi possível entrar agora. Tente novamente.", email };
  }

  if (!result.ok) {
    return {
      error:
        result.reason === "rate_limited"
          ? "Muitas tentativas. Aguarde alguns minutos e tente novamente."
          : GENERIC_ERROR,
      email,
    };
  }

  await setSessionCookie(result.token, result.expiresAt);
  redirect(safeRedirectPath(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) {
    await revokeSession(getDb(), token);
  }
  await clearSessionCookie();
  redirect(LOGIN_PATH);
}
