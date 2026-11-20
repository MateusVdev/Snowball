import { expect, test } from "@playwright/test";
import { login, norm } from "./helpers";

/** "R$ 1.234,56" → 1234.56 */
function brl(text: string | null) {
  const m = /R\$\s*([\d.]+,\d{2})/.exec(norm(text));
  if (!m) throw new Error(`Valor não encontrado em: ${text}`);
  return Number(m[1].replace(/\./g, "").replace(",", "."));
}
const fmt = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("Caixinha Turbo: cadastrar, ver na lista e somar no patrimônio do dashboard", async ({ page }) => {
  // Patrimônio antes (só FIIs dos specs anteriores).
  const before = brl(await page.getByTestId("overview-patrimony").textContent());
  await expect(page.getByTestId("patrimony-class-FIXED_INCOME")).toHaveCount(0);

  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Renda fixa" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Renda fixa");
  await page.getByRole("link", { name: "Adicionar título" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Adicionar título");
  await expect(page.getByTestId("fixed-income-notice")).toContainText("Valores estimados com base no CDI/Selic oficial do Banco Central");

  const form = page.getByTestId("create-fixed-income-form");
  await form.getByLabel("Nome").fill("Caixinha Turbo");
  await form.getByLabel("Emissor (opcional)").fill("Nubank");
  // LCI/LCA marcam isento automaticamente; CDB volta a não isento.
  await form.getByLabel("Tipo").selectOption("LCI");
  await expect(form.getByTestId("tax-exempt")).toBeChecked();
  await form.getByLabel("Tipo").selectOption("CDB");
  await expect(form.getByTestId("tax-exempt")).not.toBeChecked();
  await form.getByLabel(/Rentabilidade/).fill("115");
  await form.getByLabel("Valor aplicado (R$)").fill("91,00");
  await form.getByRole("button", { name: "Cadastrar título" }).click();

  // Detalhe do título
  await expect(page).toHaveURL(/\/renda-fixa\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Caixinha Turbo");
  await expect(page.getByText("CDB · Nubank · 115% do CDI · com IR · liquidez diária")).toBeVisible();
  await expect(page.locator('[data-stat="Valor aplicado"]')).toContainText("R$ 91,00");
  await expect(page.getByTestId("movements-table")).toContainText("Aporte");
  await expect(page.getByTestId("fixed-income-notice")).toBeVisible();

  // Lista
  await page.getByRole("link", { name: "Renda fixa" }).first().click();
  const row = page.getByTestId("fixed-income-table").getByRole("row", { name: /Caixinha Turbo/ });
  await expect(row).toContainText("Nubank");
  await expect(row).toContainText("115% do CDI");
  await expect(row).toContainText("R$ 91,00");
  await expect(page.locator('[data-stat="Valor aplicado"]')).toContainText("R$ 91,00");

  // Dashboard: renda fixa como classe de ativo e somada ao total.
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Visão geral" }).click();
  await expect(page.getByTestId("patrimony-class-FIXED_INCOME")).toContainText("Renda fixa");
  await expect(page.getByTestId("patrimony-class-FIXED_INCOME")).toContainText("R$ 91,00");
  await expect(page.getByTestId("patrimony-class-FII")).toContainText(`R$ ${fmt(before)}`);
  await expect(page.getByTestId("overview-patrimony")).toContainText(`R$ ${fmt(before + 91)}`);
});

test("central de dados mostra o status do Banco Central (CDI/Selic)", async ({ page }) => {
  await page.goto("/dados");
  const bcb = page.getByTestId("provider-bcb");
  await expect(bcb).toContainText("Banco Central (CDI/Selic)");
  await expect(bcb).toContainText("Desativado"); // E2E roda com INTEGRATIONS_ENABLED=false
  await expect(page.getByTestId("index-status-CDI")).toBeVisible();
  await expect(page.getByTestId("index-status-SELIC")).toBeVisible();
});

test("exportação de renda fixa traz a Caixinha Turbo", async ({ page }) => {
  await page.goto("/dados");
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-renda-fixa-csv").click()]);
  const text = (await (await csv.createReadStream()).toArray()).join("");
  expect(text).toContain("Caixinha Turbo;Nubank;CDB;115% do CDI");
});
