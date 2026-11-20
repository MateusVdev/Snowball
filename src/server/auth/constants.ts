/**
 * Constantes de autenticação sem dependências de servidor,
 * para que possam ser importadas também pelo proxy (src/proxy.ts).
 */
export const SESSION_COOKIE_NAME = "bdn_session";

/** Rotas acessíveis sem sessão. */
/** `/api/cron` valida o próprio segredo (CRON_SECRET) no route handler. */
export const PUBLIC_PATHS = ["/login", "/api/health", "/api/cron"] as const;

export const LOGIN_PATH = "/login";
export const DEFAULT_AUTHENTICATED_PATH = "/dashboard";
