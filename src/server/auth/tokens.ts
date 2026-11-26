import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Gera um token de sessão opaco (256 bits) codificado em base64url. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * O banco guarda apenas o SHA-256 do token: um vazamento da tabela de sessões
 * não permite sequestrar sessões ativas.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Formato esperado do token antes de qualquer consulta ao banco. */
export function isWellFormedSessionToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/**
 * Compara segredos em tempo constante, inclusive quando os tamanhos diferem
 * (compara os SHA-256, de tamanho fixo): não revela nem o tamanho do segredo.
 */
export function secretsEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && provided.length === expected.length;
}
