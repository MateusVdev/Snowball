import { expect, test } from "@playwright/test";
import { E2E_USER } from "./fixtures";

test.describe("autenticação", () => {
  test("health check público responde com o banco ativo", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "up" });
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["x-powered-by"]).toBeUndefined();
  });

  test("rota privada sem sessão redireciona para o login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  });

  test("API privada sem sessão responde 401", async ({ request }) => {
    const response = await request.get("/api/qualquer-rota-privada");
    expect(response.status()).toBe(401);
  });

  test("cookie de sessão forjado não dá acesso", async ({ page, context }) => {
    await context.addCookies([
      {
        name: "bdn_session",
        value: "a".repeat(43),
        domain: "localhost",
        path: "/",
      },
    ]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("credenciais inválidas mostram erro genérico", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(E2E_USER.email);
    await page.getByLabel("Senha").fill("senha-errada");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator("[data-slot=alert]")).toContainText(
      "E-mail ou senha inválidos.",
    );
    await expect(page).toHaveURL(/\/login$/);
  });

  test("login, sessão segura, acesso à área privada e logout", async ({
    page,
    context,
  }) => {
    await page.goto("/dashboard");
    await page.getByLabel("E-mail").fill(E2E_USER.email);
    await page.getByLabel("Senha").fill(E2E_USER.password);
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: `Olá, ${E2E_USER.name}` }),
    ).toBeVisible();

    const cookie = (await context.cookies()).find(
      (c) => c.name === "bdn_session",
    );
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    // O token não é acessível via JavaScript.
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      "bdn_session",
    );

    // Usuário autenticado que abre /login é levado ao painel.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Após o logout, o mesmo token deixou de valer (revogado no banco).
    await context.addCookies([{ ...cookie!, expires: -1 }]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});
