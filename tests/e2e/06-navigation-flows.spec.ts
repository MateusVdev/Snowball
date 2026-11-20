import { expect, test } from "@playwright/test";
import { login, norm } from "./helpers";

/**
 * Navegação completa e fluxos finais. Usa o estado deixado pelos specs
 * anteriores (MXRF11 e HGLG11, proventos, simulações).
 */
test.describe.configure({ mode: "serial" });

const NAV = [
  ["Visão geral", "/dashboard", /Olá,/],
  ["Minha carteira", "/carteira", /Carteira/],
  ["Análise da carteira", "/analise", /Análise da carteira/],
  ["Movimentações", "/operacoes", /Histórico de operações/],
  ["Dividendos", "/proventos", /Proventos/],
  ["Análise individual", "/fundos", /Análise individual dos FIIs/],
  ["Simulador bola de neve", "/simulador", /Simulador Bola de Neve/],
  ["Metas financeiras", "/metas", /Metas financeiras/],
  ["Calendário de proventos", "/calendario", /Calendário de proventos/],
  ["Central de dados", "/dados", /Central de dados/],
  ["Configurações", "/configuracoes", /Configurações/],
] as const;

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("menu lateral: todas as seções abrem e marcam o item ativo", async ({ page }) => {
  for (const [label, path, heading] of NAV) {
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  }
});

test("menu no celular abre como gaveta e navega", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await login(page);
  await page.getByRole("button", { name: "Abrir menu" }).click();
  const dialog = page.getByRole("dialog", { name: "Menu" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("link", { name: "Metas financeiras" }).click();
  await expect(page).toHaveURL(/\/metas$/);
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});

test("visão geral com valores do banco", async ({ page }) => {
  await page.goto("/dashboard");
  // Carteira dos specs anteriores: MXRF11 21 cotas a 8,52 (178,92) + HGLG11 1 cota a 141,80 = 320,72
  await expect(page.getByTestId("overview-patrimony")).toContainText("R$ 320,72");
  expect(norm(await page.locator('[data-stat="Quantidade de cotas"]').textContent())).toContain("22");
  await expect(page.getByText("Evolução patrimonial")).toBeVisible();
  await expect(page.getByText("Distribuição da carteira")).toBeVisible();
});

test("consulta de cotação: atualização manual reflete na carteira e na posição", async ({ page }) => {
  await page.goto("/carteira/HGLG11");
  await page.getByLabel("Cotação (R$)").fill("150,00");
  await page.locator("[data-testid=quote-form] button[type=submit]").click();
  await expect(page.locator('[data-stat="Cotação atual"]')).toContainText("R$ 150,00");
  await expect(page.locator('[data-stat="Próximo provento anunciado"]')).toContainText("R$ 1,20"); // anunciado no spec 04
  await page.goto("/fundos?q=hglg");
  await expect(page.getByTestId("fund-card-HGLG11")).toContainText("R$ 150,00");
  await expect(page.getByTestId("fund-card-MXRF11")).toHaveCount(0);
});

test("metas: criar com estimativa pela simulação e ver o progresso", async ({ page }) => {
  await page.goto("/metas");
  await page.getByLabel("Nome").last().fill("30 cotas");
  await page.getByLabel("Tipo").last().selectOption("TOTAL_SHARES");
  await page.getByLabel("Meta").last().fill("30");
  await page.getByLabel("Estimar com a simulação").last().selectOption({ index: 1 });
  await page.locator("[data-testid=goal-form] button[type=submit]").click();
  await expect(page.getByTestId("form-success")).toContainText("Meta criada");
  const card = page.getByTestId("goal-30 cotas");
  await expect(card).toContainText("22 cotas de 30 cotas");
  await expect(card).toContainText("Faltam 8 cotas");
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "73");
  await page.goto("/dashboard");
  await expect(page.getByText("30 cotas", { exact: true })).toBeVisible();
});

test("calendário mostra pagamentos confirmados e estimativas", async ({ page }) => {
  await page.goto("/calendario?mes=2099-02");
  const list = page.getByTestId("calendar-month-list");
  await expect(list).toContainText("HGLG11");
  await expect(list).toContainText("Anunciado");
  await expect(list).toContainText("MXRF11");
  await expect(list).toContainText("Previsto (estimativa)");
});

test("central de dados: exportação CSV/Excel e backup", async ({ page }) => {
  await page.goto("/dados");
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-operacoes-csv").click()]);
  const csvText = (await (await csv.createReadStream()).toArray()).join("");
  expect(csvText.charCodeAt(0)).toBe(0xfeff);
  expect(csvText).toContain("Fundo;Tipo;Situação");
  expect(csvText).toContain("MXRF11;SELL;ACTIVE");

  const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-all").click()]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  const bytes = Buffer.concat(await (await xlsx.createReadStream()).toArray());
  expect(bytes.subarray(0, 2).toString()).toBe("PK"); // pacote zip (OOXML)

  const [backup] = await Promise.all([page.waitForEvent("download"), page.getByTestId("backup-download").click()]);
  const json = JSON.parse(Buffer.concat(await (await backup.createReadStream()).toArray()).toString());
  expect(json.format).toBe("bola-de-neve-backup");
  expect(json.data.funds.length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(json)).not.toMatch(/password|tokenHash/i);

  // Restaurar nesta conta (com dados) é recusado sem alterar nada
  await page.getByLabel("Restaurar a partir de um backup").setInputFiles({ name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(json)) });
  await page.getByText("Entendo que a restauração").click();
  await page.locator("[data-testid=restore-form] button[type=submit]").click();
  await expect(page.getByTestId("restore-form")).toContainText("conta sem dados");
});

test("exportação exige sessão", async ({ request }) => {
  const res = await request.get("/api/export/carteira?formato=csv", { headers: { cookie: "" } });
  expect(res.status()).toBe(401);
  expect((await request.get("/api/backup")).status()).toBe(401);
});

test("configurações: salvar perfil com feedback", async ({ page }) => {
  await page.goto("/configuracoes");
  await page.getByLabel("Nome").fill("Usuário E2E");
  await page.locator("[data-testid=profile-form] button[type=submit]").click();
  await expect(page.getByTestId("form-success")).toContainText("Perfil atualizado");
  await expect(page.getByText("Esta sessão")).toBeVisible();
});

test("simulador: reinvestimento e cotas compradas só com dividendos em destaque", async ({ page }) => {
  await page.goto("/simulador/nova?origem=exemplo");
  await page.getByLabel("Nome da simulação").fill("E2E reinvestimento");
  await page.locator("[data-testid=simulation-editor] button[type=submit]").click();
  await expect(page).toHaveURL(/\/simulador\/[a-z0-9]+$/);
  await expect(page.getByTestId("dividend-only-highlight")).toContainText("12");
  await expect(page.getByTestId("strategy-REINVEST_NONE")).toContainText("96");
  // Duplicar um cenário como nova simulação
  await page.getByRole("button", { name: "Duplicar como simulação" }).nth(1).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Conservador");
});
