import { isIP } from "node:net";

/**
 * IP do cliente para limite de tentativas e auditoria — sem confiar em valores
 * que o próprio cliente consegue inventar.
 *
 * - Na Vercel (`VERCEL=1`), `x-vercel-forwarded-for` / `x-real-ip` /
 *   `x-forwarded-for` são definidos pela plataforma (o valor enviado pelo
 *   cliente é sobrescrito).
 * - Fora da Vercel, atrás de UM proxy reverso (nginx etc.): `x-real-ip`, ou o
 *   valor de `x-forwarded-for` acrescentado pelo proxy.
 * - Em listas ("a, b, c") vale sempre o ÚLTIMO valor: é o que o proxy mais
 *   próximo viu. Os anteriores podem ter sido inventados pelo cliente.
 * - Só aceita endereços IP válidos (nada de texto arbitrário no banco).
 * Sem proxy na frente, nenhum cabeçalho é confiável (ver ARCHITECTURE.md).
 */
export function clientIpFromHeaders(
  get: (name: string) => string | null | undefined,
  opts: { onVercel?: boolean } = {},
): string | null {
  const last = (v: string | null | undefined) => v?.split(",").at(-1);
  const candidates = opts.onVercel
    ? [last(get("x-vercel-forwarded-for")), last(get("x-real-ip")), last(get("x-forwarded-for"))]
    : [last(get("x-real-ip")), last(get("x-forwarded-for"))];
  for (const candidate of candidates) {
    const ip = candidate?.trim();
    if (ip && ip.length <= 64 && isIP(ip)) return ip;
  }
  return null;
}

/** Os 8 grupos de 16 bits de um IPv6 já validado (aceita "::" e IPv4 embutido). */
function ipv6Groups(ip: string): number[] | null {
  let address = ip.toLowerCase();
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  const embedded = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  if (embedded) {
    const [a, b, c, d] = embedded.slice(1).map(Number);
    address = `${address.slice(0, embedded.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail] : head;
  if (groups.length !== 8) return null;
  const numbers = groups.map((g) => Number.parseInt(g, 16));
  return numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? numbers : null;
}

/**
 * Chave de IP para o LIMITE de tentativas.
 * - IPv4: o próprio endereço.
 * - IPv6: o bloco /64. Uma única conexão (casa, servidor na nuvem) costuma
 *   receber um /64 inteiro — trocar de endereço a cada tentativa é trivial e,
 *   sem isso, cada endereço ganhava um limite novo.
 * - IPv4 mapeado em IPv6 (::ffff:a.b.c.d) vira o IPv4 (mesmo cliente).
 */
export function rateLimitIpKey(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) return null;
  const groups = ipv6Groups(ip);
  if (!groups) return null;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}
