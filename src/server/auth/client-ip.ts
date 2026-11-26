import { isIP } from "node:net";

/**
 * IP do cliente para limite de tentativas e auditoria — sem confiar em valores
 * que o próprio cliente consegue inventar.
 *
 * - Na Vercel (`VERCEL=1`), `x-vercel-forwarded-for` / `x-real-ip` são
 *   definidos pela plataforma (o valor enviado pelo cliente é sobrescrito).
 * - Fora da Vercel, atrás de UM proxy reverso (nginx etc.): `x-real-ip`, ou o
 *   ÚLTIMO valor de `x-forwarded-for` (o acrescentado pelo proxy). O PRIMEIRO
 *   valor (usado antes) é controlado pelo cliente e permitia trocar de "IP" a
 *   cada tentativa.
 * - Só aceita endereços IP válidos (nada de texto arbitrário no banco).
 * Sem proxy na frente, nenhum cabeçalho é confiável (ver ARCHITECTURE.md).
 */
export function clientIpFromHeaders(
  get: (name: string) => string | null | undefined,
  opts: { onVercel?: boolean } = {},
): string | null {
  const first = (v: string | null | undefined) => v?.split(",")[0];
  const last = (v: string | null | undefined) => v?.split(",").at(-1);
  const candidates = opts.onVercel
    ? [first(get("x-vercel-forwarded-for")), get("x-real-ip"), first(get("x-forwarded-for"))]
    : [get("x-real-ip"), last(get("x-forwarded-for"))];
  for (const candidate of candidates) {
    const ip = candidate?.trim();
    if (ip && ip.length <= 64 && isIP(ip)) return ip;
  }
  return null;
}
