import "server-only";
import { cookies, headers } from "next/headers";
import { getEnv } from "@/server/env";
import { SESSION_COOKIE_NAME } from "./constants";
import type { RequestMeta } from "./service";

/**
 * Integração da sessão com o Next.js (cookies e headers da requisição).
 * Cookie: HttpOnly (inacessível a JS), SameSite=Lax (mitiga CSRF), Secure em
 * produção, Path=/ e expiração igual à da sessão no banco.
 */

function isSecureCookie(): boolean {
  const env = getEnv();
  return env.SESSION_COOKIE_SECURE ?? env.NODE_ENV === "production";
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Metadados para auditoria/rate limit. Atenção: X-Forwarded-For só é
 * confiável atrás de um proxy reverso que o sobrescreva (ver ARCHITECTURE.md).
 */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ipAddress: (forwarded || h.get("x-real-ip") || null)?.slice(0, 64) ?? null,
    userAgent: h.get("user-agent"),
  };
}
