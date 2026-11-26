import { expect, test } from "@playwright/test";
import { E2E_USER } from "./fixtures";
import { login } from "./helpers";

/**
 * Regressão da auditoria de segurança, no navegador real contra o build de
 * produção (ver DOCUMENTATION/SECURITY.md).
 */

const EVIL = "%2F%09%2Fevil.example"; // "/<TAB>/evil.example": o navegador remove o TAB → "//evil.example"

test("login com ?next= malicioso (TAB) termina no próprio site", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!new URL(r.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)) external.push(r.url());
  });
  await page.goto(`/login?next=${EVIL}`);
  await expect(page.locator('input[name="next"]')).toHaveValue("/dashboard");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/dashboard$/);

  // Já logado: a página de login redireciona direto — também para o próprio site.
  await page.goto(`/login?next=${EVIL}`);
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/dashboard$/);
  await page.goto("/login?next=%2Fa%2F..%2F%2Fevil.example");
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/dashboard$/);
  expect(external).toEqual([]);

  // Destinos internos legítimos continuam funcionando.
  await page.goto("/login?next=%2Fmetas");
  await expect(page).toHaveURL(/\/metas$/);
});

test("cabeçalhos de segurança nas respostas", async ({ request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toContain("object-src 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("sem sessão: APIs privadas recusam e páginas privadas mandam para o login", async ({ request }) => {
  for (const path of ["/api/export/tudo?formato=xlsx", "/api/export/renda-fixa", "/api/backup"]) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(401);
  }
  expect((await request.get("/api/cron/refresh")).status()).toBe(404); // sem CRON_SECRET: desligado
  for (const path of ["/dashboard", "/renda-fixa", "/configuracoes", "/simulador/patrimonio"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(307);
    expect(res.headers().location, path).toContain("/login?next=");
  }
  // Cookie de sessão inventado não abre a área privada.
  const fake = await request.get("/api/backup", { headers: { Cookie: "bdn_session=" + "A".repeat(43) } });
  expect(fake.status()).toBe(401);
});

test("CSRF: Server Action reenviada a partir de outro site é recusada (nada é alterado)", async ({ page }) => {
  await login(page);
  await page.goto("/configuracoes");
  const nameField = page.getByLabel("Nome");

  // 1. Captura uma chamada real e válida da action "salvar perfil".
  const [captured] = await Promise.all([
    page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/configuracoes"),
    (async () => {
      await nameField.fill("Nome legitimo");
      await page.locator("[data-testid=profile-form] button[type=submit]").click();
    })(),
  ]);
  await expect(page.getByTestId("form-success")).toContainText("Perfil atualizado");
  const headers = Object.fromEntries(
    Object.entries(await captured.allHeaders()).filter(([k]) => !["cookie", "content-length", "host", "connection"].includes(k)),
  );
  expect(headers["next-action"]).toBeTruthy();
  const replay = (name: string, origin: string) =>
    page.request.fetch(captured.url(), {
      method: "POST",
      headers: { ...headers, origin },
      data: Buffer.from(captured.postDataBuffer()!.toString("latin1").replace("Nome legitimo", name), "latin1"),
      maxRedirects: 0,
    });

  // 2. Controle: a mesma chamada, da MESMA origem, funciona (o reenvio é válido).
  const ok = await replay("Nome via controle", headers.origin);
  expect(ok.status()).toBe(200);
  await page.goto("/configuracoes");
  await expect(nameField).toHaveValue("Nome via controle");

  // 3. Ataque: a mesma chamada, com Origin de outro site, é recusada pelo servidor.
  const attack = await replay("Nome alterado por CSRF", "https://evil.example");
  expect(attack.status()).toBeGreaterThanOrEqual(400);
  await page.goto("/configuracoes");
  await expect(nameField).toHaveValue("Nome via controle");

  // Restaura o nome usado pelos outros testes.
  await nameField.fill(E2E_USER.name);
  await page.locator("[data-testid=profile-form] button[type=submit]").click();
  await expect(page.getByTestId("form-success")).toContainText("Perfil atualizado");
});
