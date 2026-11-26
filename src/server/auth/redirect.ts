import { DEFAULT_AUTHENTICATED_PATH, LOGIN_PATH } from "./constants";

/** Origem fictícia usada só para interpretar o caminho como o navegador faria. */
const PROBE_ORIGIN = "http://destino-interno.invalid";

/**
 * Sanitiza o destino pós-login (parâmetro `next`) contra open redirect.
 *
 * Causa raiz do problema anterior: checar o TEXTO ("não começa com //") não
 * basta, porque o navegador NORMALIZA a URL antes de seguir o redirect — por
 * exemplo, remove TAB/CR/LF ("/\t/site.com" vira "//site.com") e trata "\"
 * como "/". Por isso:
 * 1. qualquer caractere de controle (U+0000–U+001F, U+007F) ou "\" é recusado;
 * 2. o caminho é interpretado com o parser de URL do padrão WHATWG (o mesmo
 *    dos navegadores) e só é aceito se continuar na MESMA origem;
 * 3. devolve a forma normalizada (pathname + search + hash), nunca o texto cru;
 * 4. a própria página de login não é destino (evita laço).
 */
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_AUTHENTICATED_PATH;
  const raw = value.trim();
  if (!raw.startsWith("/") || raw.length > 2048 || /[\u0000-\u001F\u007F\\]/.test(raw)) {
    return DEFAULT_AUTHENTICATED_PATH;
  }
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return DEFAULT_AUTHENTICATED_PATH;
  }
  if (url.origin !== PROBE_ORIGIN) return DEFAULT_AUTHENTICATED_PATH;
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    url.pathname === LOGIN_PATH ||
    url.pathname.startsWith(`${LOGIN_PATH}/`)
  ) {
    return DEFAULT_AUTHENTICATED_PATH;
  }
  return path;
}
