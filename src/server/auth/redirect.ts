import { DEFAULT_AUTHENTICATED_PATH, LOGIN_PATH } from "./constants";

/**
 * Sanitiza o destino pós-login (parâmetro `next`) para evitar open redirect:
 * aceita apenas caminhos internos absolutos ("/algo"), nunca "//host",
 * "/\\host", URLs completas ou a própria página de login.
 */
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_AUTHENTICATED_PATH;
  const path = value.trim();
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.startsWith("/\\") ||
    path.includes("\0") ||
    /[\r\n]/.test(path) ||
    path === LOGIN_PATH ||
    path.startsWith(`${LOGIN_PATH}?`) ||
    path.startsWith(`${LOGIN_PATH}/`)
  ) {
    return DEFAULT_AUTHENTICATED_PATH;
  }
  return path;
}
