import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Hash de senhas com scrypt (nativo do Node.js, sem dependências nativas extras).
 * Formato armazenado: scrypt$N$r$p$saltBase64$hashBase64
 *
 * Parâmetros: N=2^15, r=8, p=1, chave de 64 bytes, salt de 16 bytes —
 * acima do mínimo recomendado pela OWASP para scrypt (N=2^17 com r=8 é o
 * recomendado "forte"; 2^15 mantém o login abaixo de ~100ms em hardware modesto).
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function scryptAsync(
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { ...params, maxmem: 256 * params.N * params.r },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scryptAsync(password, salt, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  // Limites defensivos contra hashes adulterados (evita uso abusivo de memória).
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N < 2 ** 14 ||
    N > 2 ** 20 ||
    r < 1 ||
    r > 32 ||
    p < 1 ||
    p > 16
  ) {
    return false;
  }
  const expected = Buffer.from(hashB64, "base64");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), {
    N,
    r,
    p,
  });
  return timingSafeEqual(actual, expected);
}

/**
 * Hash válido de uma senha aleatória, usado para gastar o mesmo tempo
 * quando o e-mail não existe (reduz enumeração de usuários por tempo de resposta).
 */
let dummyHashPromise: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString("hex"));
  return dummyHashPromise;
}
