import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * Simulador de renda fixa. Estado dos specs anteriores: Caixinha Turbo (R$ 91,
 * aportada hoje — saldo bruto R$ 91,00) e CDI de 0,05% ao dia gravado no banco
 * de teste pelo spec 08 (= 13,42% a.a.).
 */
test.beforeEach(async ({ page }) => {
  await login(page);
});

test("simular com aportes, isenção de IR, salvar, abrir e excluir", async ({ page }) => {
  await page.goto("/renda-fixa");
  await page.getByRole("link", { name: "Simular com aportes" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Simulador de renda fixa");

  const form = page.getByTestId("fi-sim-form");
  // Pré-preenchidos: saldo atual e CDI atual (editáveis)
  await expect(form.getByLabel("Valor inicial (R$)")).toHaveValue("91,00");
  await expect(form.getByLabel("CDI anual estimado (% a.a.)")).toHaveValue("13,42");
  await expect(page.getByText("CDI atual: 13,42% a.a.")).toBeVisible();
  await expect(page.getByTestId("simulation-result")).toBeVisible(); // já simula com os valores atuais

  await form.getByLabel("Aporte mensal (R$)").fill("100");
  await form.getByLabel("Prazo", { exact: true }).fill("12");
  await form.getByLabel("Unidade do prazo").selectOption("MONTHS");
  await form.getByLabel("% do CDI", { exact: true }).fill("115");
  await form.getByLabel("CDI anual estimado (% a.a.)").fill("12");
  await form.getByRole("button", { name: "Simular" }).click();

  const result = page.getByTestId("simulation-result");
  await expect(result.locator('[data-stat="Total aplicado"]')).toContainText("R$ 1.291,00"); // 91 + 12 × 100
  await expect(page.getByTestId("fi-sim-month-12")).toBeVisible();
  await expect(page.getByTestId("fi-sim-month-13")).toHaveCount(0);
  await expect(page.getByRole("img", { name: /Evolução do valor líquido/ })).toBeVisible();
  await expect(page.getByTestId("simulation-notice")).toContainText("Simulação hipotética");
  await expect(result.locator('[data-stat="IR estimado"]')).not.toContainText("R$ 0,00");
  await expect(page.getByTestId("simulation-result")).toContainText("115% do CDI (CDI estimado 12% a.a.)");

  // Isenção de IR selecionável
  await form.getByLabel("Isento de IR (ex.: LCI/LCA)").check();
  await form.getByRole("button", { name: "Simular" }).click();
  await expect(result.locator('[data-stat="IR estimado"]')).toContainText("R$ 0,00");
  await expect(result.locator('[data-stat="IR estimado"]')).toContainText("Isento");

  // Erro de validação no campo certo
  await form.getByLabel("CDI anual estimado (% a.a.)").fill("");
  await form.getByRole("button", { name: "Simular" }).click();
  await expect(page.getByTestId("fi-sim-error")).toContainText("Verifique os campos");
  await expect(form.getByText("Informe o CDI anual estimado.")).toBeVisible();
  await form.getByLabel("CDI anual estimado (% a.a.)").fill("12");
  await form.getByRole("button", { name: "Simular" }).click();

  // Salvar
  const save = page.getByTestId("fi-sim-save-form");
  await save.getByLabel("Nome").fill("Caixinha + R$ 100 por 1 ano");
  await save.getByRole("button", { name: "Salvar simulação" }).click();
  await expect(page).toHaveURL(/\/renda-fixa\/simulador\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Caixinha + R$ 100 por 1 ano");
  await expect(page.locator('[data-stat="Total aplicado"]')).toContainText("R$ 1.291,00");
  await expect(page.locator('[data-stat="IR estimado"]')).toContainText("R$ 0,00");

  // Aparece na lista de salvas
  await page.getByRole("link", { name: "Simulador", exact: true }).click();
  await expect(page.getByTestId("fi-sim-saved")).toContainText("Caixinha + R$ 100 por 1 ano");

  // Excluir com confirmação
  await page.getByRole("link", { name: "Caixinha + R$ 100 por 1 ano" }).click();
  const del = page.getByTestId("fi-sim-delete-form");
  await del.getByRole("button", { name: "Excluir" }).click();
  await expect(del).toContainText("Marque a confirmação");
  await del.getByLabel("Confirmo a exclusão desta simulação").check();
  await del.getByRole("button", { name: "Excluir" }).click();
  await expect(page).toHaveURL(/\/renda-fixa\/simulador$/);
  await expect(page.getByText("Nenhuma simulação de renda fixa salva.")).toBeVisible();
});
