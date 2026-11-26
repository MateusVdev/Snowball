import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { clientIpFromHeaders, rateLimitIpKey } from "@/server/auth/client-ip";
import { PUBLIC_PATHS } from "@/server/auth/constants";
import { LOGIN_RATE_LIMIT, isLoginRateLimited } from "@/server/auth/rate-limit";
import { secretsEqual } from "@/server/auth/tokens";
import { createHealthCache } from "@/server/db/health-cache";

/** Testes de regressão da auditoria de segurança (ver DOCUMENTATION/SECURITY.md). */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("guarda: toda Server Action exige sessão", () => {
  // Server Actions são endpoints POST públicos e podem ser chamadas a partir de
  // QUALQUER página (inclusive /login): o layout/proxy não as protege.
  const PUBLIC_ACTIONS = new Set(["loginAction", "logoutAction"]);
  const DIRECTIVE = /["']use server["']/; // aspas simples ou duplas, em qualquer posição
  const sources = walk("src").filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f));
  const files = sources.filter((f) => DIRECTIVE.test(readFileSync(f, "utf8")));

  it("encontra os módulos de actions (o guarda não está vazio)", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it("a diretiva só aparece no topo dos módulos de actions (nenhuma action embutida em página/componente)", () => {
    for (const f of files) {
      expect(f, f).toMatch(/src\/server\/(actions\/[^/]+|auth\/actions)\.ts$/);
      expect(readFileSync(f, "utf8").trimStart(), f).toMatch(/^["']use server["'];?/);
    }
  });

  it.each(files)("%s: só exporta 'export async function' e cada uma chama requireUser() no início", (file) => {
    const source = readFileSync(file, "utf8");
    // Qualquer outra forma de export (arrow function, const, default, export {…})
    // escaparia da verificação abaixo — então é proibida nos módulos de actions.
    // Tipos (interface/type) são apagados na compilação e não viram endpoints.
    const runtimeExports = [...source.matchAll(/^\s*export\b(.*)$/gm)]
      .map((m) => m[1].trim())
      .filter((e) => !/^(interface|type) \w+/.test(e));
    for (const e of runtimeExports) expect(e, `export não permitido: "export ${e}"`).toMatch(/^async function \w+\(/);
    const actions = [...source.matchAll(/export async function (\w+)\(/g)];
    expect(actions.length).toBe(runtimeExports.length);
    for (const m of actions) {
      if (PUBLIC_ACTIONS.has(m[1])) continue;
      const body = source.slice(m.index!, m.index! + 600);
      const open = body.indexOf("{", body.indexOf(")"));
      expect(body.slice(open, open + 300), `${m[1]} deve chamar requireUser()`).toMatch(/^\{\s*(\/\/[^\n]*\s*)*const \w+ = await requireUser\(\);/);
    }
  });

  it("o app nunca usa a conferência de senha SEM limite (verifyUserPassword)", () => {
    for (const f of sources) {
      if (f.endsWith("src/server/auth/service.ts")) continue;
      expect(readFileSync(f, "utf8"), f).not.toMatch(/verifyUserPassword/);
    }
  });
});

describe("guarda: rotas de API", () => {
  it("só /login, /api/health e /api/cron são públicos no proxy", () => {
    expect([...PUBLIC_PATHS]).toEqual(["/login", "/api/health", "/api/cron"]);
  });

  it("rotas de API privadas validam a sessão no próprio handler", () => {
    const routes = walk("src/app/api").filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      const source = readFileSync(r, "utf8");
      if (r.includes("/health/")) continue; // público por definição, sem dados
      if (r.includes("/cron/")) {
        expect(source, r).toMatch(/secretsEqual\(/); // segredo comparado em tempo constante
        continue;
      }
      expect(source, r).toMatch(/getCurrentUser\(\)|requireUser\(\)/);
      expect(source, r).toMatch(/status: 401/);
    }
  });
});

describe("IP do cliente (limite de tentativas)", () => {
  const h = (values: Record<string, string>) => (name: string) => values[name] ?? null;

  it("fora da Vercel, ignora o PRIMEIRO valor de X-Forwarded-For (inventado pelo cliente)", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIpFromHeaders(h({ "x-real-ip": "198.51.100.2", "x-forwarded-for": "1.1.1.1" }))).toBe("198.51.100.2");
  });

  it("na Vercel, usa o cabeçalho definido pela plataforma", () => {
    expect(clientIpFromHeaders(h({ "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": "203.0.113.9" }), { onVercel: true })).toBe("203.0.113.9");
  });

  it("em listas vale o ÚLTIMO valor (o anterior pode ter sido inventado pelo cliente)", () => {
    expect(clientIpFromHeaders(h({ "x-vercel-forwarded-for": "1.1.1.1, 203.0.113.9" }), { onVercel: true })).toBe("203.0.113.9");
    expect(clientIpFromHeaders(h({ "x-real-ip": "1.1.1.1, 198.51.100.2" }))).toBe("198.51.100.2");
  });

  it("só aceita IPs válidos (nada de texto arbitrário no banco)", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "<script>" }))).toBeNull();
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.1.1.1, x".repeat(40) }))).toBeNull();
    expect(clientIpFromHeaders(h({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIpFromHeaders(h({}))).toBeNull();
  });
});

describe("chave de IP do limite de tentativas", () => {
  it.each([
    ["203.0.113.5", "203.0.113.5"],
    ["::ffff:203.0.113.5", "203.0.113.5"], // IPv4 mapeado = o mesmo cliente
    ["::FFFF:cb00:7105", "203.0.113.5"],
    ["2001:db8:1:2::1", "2001:db8:1:2::/64"],
    ["2001:DB8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2::/64"], // mesmo /64
    ["2001:db8:1:3::1", "2001:db8:1:3::/64"], // outro /64
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["2001:db8::203.0.113.5", "2001:db8:0:0::/64"],
    ["::", "0:0:0:0::/64"],
  ])("%s → %s", (ip, key) => {
    expect(rateLimitIpKey(ip)).toBe(key);
  });

  it.each(["", "abc", "1.2.3", "2001:db8::1::2", null, undefined])("inválido (%s) → null", (ip) => {
    expect(rateLimitIpKey(ip)).toBeNull();
  });
});

describe("política de tentativas de login", () => {
  it("mesmo e-mail + mesmo IP: limite baixo", () => {
    const max = LOGIN_RATE_LIMIT.maxFailuresPerEmailAndIp;
    expect(isLoginRateLimited({ byEmail: max - 1, byIp: max - 1, byEmailAndIp: max - 1 })).toBe(false);
    expect(isLoginRateLimited({ byEmail: max, byIp: max, byEmailAndIp: max })).toBe(true);
  });

  it("um IP atacante não bloqueia o dono (outro IP), até o teto global por e-mail", () => {
    expect(isLoginRateLimited({ byEmail: 10, byIp: 0, byEmailAndIp: 0 })).toBe(false);
    expect(isLoginRateLimited({ byEmail: LOGIN_RATE_LIMIT.maxFailuresPerEmail, byIp: 0, byEmailAndIp: 0 })).toBe(true);
  });

  it("IP desconhecido: o limite baixo vale para o e-mail inteiro", () => {
    expect(isLoginRateLimited({ byEmail: LOGIN_RATE_LIMIT.maxFailuresPerEmailAndIp, byIp: 0 })).toBe(true);
  });
});

describe("comparação de segredos (cron)", () => {
  it("compara corretamente, inclusive com tamanhos diferentes", () => {
    const secret = "s".repeat(40);
    expect(secretsEqual(secret, secret)).toBe(true);
    expect(secretsEqual("s".repeat(39), secret)).toBe(false);
    expect(secretsEqual("", secret)).toBe(false);
    expect(secretsEqual(`${secret}x`, secret)).toBe(false);
  });
});

describe("health check público com cache", () => {
  it("no máximo uma consulta ao banco por janela; simultâneas compartilham a consulta", async () => {
    let now = 0;
    const check = vi.fn(async () => true);
    const cached = createHealthCache(check, 10_000, () => now);
    await Promise.all(Array.from({ length: 50 }, () => cached()));
    expect(check).toHaveBeenCalledTimes(1);
    now = 9_999;
    await cached();
    expect(check).toHaveBeenCalledTimes(1);
    now = 10_000;
    await cached();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("falha do banco vira 'down' (sem exceção)", async () => {
    const cached = createHealthCache(async () => { throw new Error("db"); }, 10_000, () => 0);
    expect(await cached()).toBe(false);
  });
});
