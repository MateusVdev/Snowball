import { NextResponse, type NextRequest } from "next/server";
import {
  LOGIN_PATH,
  PUBLIC_PATHS,
  SESSION_COOKIE_NAME,
} from "@/server/auth/constants";

/**
 * Checagem OTIMISTA de autenticação (apenas presença do cookie).
 * Não acessa o banco: a validação real da sessão é feita pela DAL
 * (src/server/auth/dal.ts) em cada layout/página/action/route handler.
 */
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const hasSessionCookie = Boolean(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
  if (hasSessionCookie) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL(LOGIN_PATH, request.url);
  if (pathname !== "/") {
    loginUrl.searchParams.set("next", `${pathname}${search}`);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Tudo, exceto assets estáticos do Next e arquivos públicos comuns.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
