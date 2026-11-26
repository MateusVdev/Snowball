import "server-only";
import { cookies, headers } from "next/headers";
import { getEnv } from "@/server/env";
import { clientIpFromHeaders } from "./client-ip";
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

/** Metadados para auditoria/rate limit (IP obtido de forma segura — ver client-ip.ts). */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return {
    ipAddress: clientIpFromHeaders((name) => h.get(name), { onVercel: process.env.VERCEL === "1" }),
    userAgent: h.get("user-agent")?.slice(0, 512) ?? null,
  };
}
