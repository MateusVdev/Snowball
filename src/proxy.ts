import { NextResponse, type NextRequest } from "next/server";
import {
  LOGIN_PATH,
  PUBLIC_PATHS,
  SESSION_COOKIE_NAME,
} from "@/server/auth/constants";

/**
 * Proxy (antigo middleware):
 * 1. Content-Security-Policy com nonce por requisição: scripts só com o nonce
 *    (o Next aplica o nonce automaticamente aos próprios scripts) +
 *    'strict-dynamic'. `style-src` permite 'unsafe-inline' porque gráficos e
 *    componentes usam atributos style (risco bem menor que scripts).
 * 2. Checagem OTIMISTA de autenticação (apenas presença do cookie). A
 *    validação real da sessão é feita pela DAL (src/server/auth/dal.ts) em
 *    cada layout/página/action/route handler.
 */
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function buildCsp(nonce: string, isDev: boolean) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Caminho com codificação "%" válida (o Next responde 500 para "%E0%A4%A" em rotas dinâmicas). */
function hasValidEncoding(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return true;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");
  const { pathname, search } = request.nextUrl;

  if (!hasValidEncoding(pathname)) {
    return new NextResponse("Endereço inválido.", {
      status: 400,
      headers: { "Content-Security-Policy": csp, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const authorized = isPublicPath(pathname) || Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  let response: NextResponse;
  if (authorized) {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    response = NextResponse.next({ request: { headers } });
  } else if (pathname.startsWith("/api/")) {
    response = NextResponse.json({ error: "unauthorized" }, { status: 401 });
  } else {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
    response = NextResponse.redirect(loginUrl);
  }
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Tudo, exceto os assets estáticos do Next e o favicon. Antes, qualquer URL
    // terminada em .png/.svg/… pulava o proxy — e uma PÁGINA do app nesse
    // endereço (ex.: /renda-fixa/x.png) era servida SEM CSP. A pasta public/
    // está vazia: não há imagens públicas a liberar.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
