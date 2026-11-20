import { expect, test, type Page } from "@playwright/test";
import { login, norm } from "./helpers";

/** Simulador pela interface. Usa a carteira deixada pelos specs anteriores. */
test.describe.configure({ mode: "serial" });

const cells = async (page: Page, month: number) =>
  norm((await page.getByTestId(`sim-month-${month}`).locator("td").allInnerTexts()).join(" "));

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("exemplo das 96 cotas: cria, confere meses 1–4 e marcos", async ({ page }) => {
  await page.goto("/simulador/nova?origem=exemplo");
  await expect(page.getByTestId("sim-preview")).toContainText("108 cotas");
  await page.locator("[data-testid=simulation-editor] button[type=submit]").click();
  await expect(page).toHaveURL(/\/simulador\/[a-z0-9]+$/);
  // Mês, cotas iniciais, elegíveis, dividendos, não reinvestido, aportes, acumulado, compradas, finais, saldo, renda, patrimônio
  expect(await cells(page, 1)).toBe("Mês 1 96 96 R$ 9,60 R$ 0,00 R$ 0,00 R$ 9,60 0 96 R$ 9,60 R$ 9,60 R$ 969,60");
  expect(await cells(page, 2)).toBe("Mês 2 96 96 R$ 9,60 R$ 0,00 R$ 0,00 R$ 19,20 1 97 R$ 9,20 R$ 9,60 R$ 979,20");
  expect(await cells(page, 3)).toBe("Mês 3 97 97 R$ 9,70 R$ 0,00 R$ 0,00 R$ 18,90 1 98 R$ 8,90 R$ 9,70 R$ 988,90");
  expect(await cells(page, 4)).toBe("Mês 4 98 98 R$ 9,80 R$ 0,00 R$ 0,00 R$ 18,70 1 99 R$ 8,70 R$ 9,80 R$ 998,70");
  await expect(page.getByTestId("milestones")).toContainText("Primeira cota comprada apenas com dividendos: Mês 2");
  await expect(page.getByText("Simulação hipotética.")).toBeVisible();
});

test("editar (reinvestimento 50% e aporte), versionar, duplicar e excluir", async ({ page }) => {
  await page.goto("/simulador");
  await page.getByRole("link", { name: "Exemplo: 96 cotas" }).last().click();
  await page.getByRole("link", { name: "Editar premissas" }).click();
  await page.getByLabel("Reinvestimento 1").selectOption("50");
  await page.getByLabel("Aporte mensal").fill("10,00");
  await expect(page.getByTestId("sim-preview")).not.toContainText("108 cotas");
  await page.locator("[data-testid=simulation-editor] button[type=submit]").click();
  await expect(page).toHaveURL(/\/simulador\/[a-z0-9]+$/);
  // Mês 1: 4,80 reinvestido + 10,00 = 14,80 → 1 cota, sobra 4,80; não reinvestido 4,80
  expect(await cells(page, 1)).toBe("Mês 1 96 96 R$ 9,60 R$ 4,80 R$ 10,00 R$ 14,80 1 97 R$ 4,80 R$ 9,60 R$ 974,80");
  await expect(page.getByText("v2 · Edição")).toBeVisible();

  await page.getByRole("button", { name: "Duplicar" }).click();
  await expect(page.getByRole("heading", { name: /\(cópia\)/ })).toBeVisible();
  await page.getByLabel("Confirmo a exclusão desta simulação").check();
  await page.locator("[data-testid=delete-simulation-form] button[type=submit]").click();
  await expect(page).toHaveURL(/\/simulador$/);
  await expect(page.getByTestId("simulation-row")).toHaveCount(1);
});

test("importar a carteira real não altera a carteira", async ({ page }) => {
  await page.goto("/carteira");
  const before = norm(await page.locator("table").textContent());
  await page.goto("/simulador/nova?origem=carteira");
  await expect(page.getByTestId("sim-fund-0")).toBeVisible();
  await page.locator("[data-testid=simulation-editor] button[type=submit]").click();
  await expect(page).toHaveURL(/\/simulador\/[a-z0-9]+$/);
  await expect(page.getByText("Cópia da carteira real")).toBeVisible();
  await page.goto("/carteira");
  expect(norm(await page.locator("table").textContent())).toBe(before);
});
