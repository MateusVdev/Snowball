/**
 * Constantes de autenticação sem dependências de servidor,
 * para que possam ser importadas também pelo proxy (src/proxy.ts).
 */
export const SESSION_COOKIE_NAME = "bdn_session";

/** Rotas acessíveis sem sessão. */
export const PUBLIC_PATHS = ["/login", "/api/health"] as const;

export const LOGIN_PATH = "/login";
export const DEFAULT_AUTHENTICATED_PATH = "/dashboard";
