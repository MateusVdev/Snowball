import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { LOGIN_PATH } from "./constants";
import { validateSessionToken, type PublicUser } from "./service";
import { readSessionToken } from "./session";

/**
 * Data Access Layer de autenticação: ÚNICO ponto onde páginas, layouts,
 * Server Actions e Route Handlers obtêm o usuário atual.
 * O proxy faz apenas uma checagem otimista (existência do cookie);
 * a verificação real (token válido e não expirado no banco) acontece aqui.
 *
 * `cache` do React deduplica a consulta dentro de uma mesma renderização.
 */
export const getCurrentUser = cache(async (): Promise<PublicUser | null> => {
  const token = await readSessionToken();
  if (!token) return null;
  return validateSessionToken(getDb(), token);
});

/** Exige sessão válida; caso contrário redireciona para o login. */
export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_PATH);
  return user;
}
