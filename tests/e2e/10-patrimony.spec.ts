import { expect, test } from "@playwright/test";
import { login, norm } from "./helpers";

/**
 * Patrimônio geral. Estado dos specs anteriores: FIIs com cotação, Caixinha
 * Turbo (renda fixa) e simulações de FIIs salvas no spec 05.
 */
test.beforeEach(async ({ page }) => {
  await login(page);
});

test("dashboard mostra o patrimônio total no topo, com a divisão por classe", async ({ page }) => {
  const hero = page.getByRole("region", { name: "Patrimônio total" });
  await expect(hero).toBeVisible();
  await expect(hero.getByTestId("overview-patrimony")).toContainText("R$");
  await expect(hero.getByTestId("patrimony-class-FII")).toContainText("FIIs");
  await expect(hero.getByTestId("patrimony-class-FIXED_INCOME")).toContainText("Renda fixa");
  await expect(hero.getByTestId("patrimony-class-FIXED_INCOME")).toContainText("Líquido estimado");
  await expect(hero).toContainText("FIIs + Renda fixa");
});

test("simulação do patrimônio total e meta FIIs + renda fixa", async ({ page }) => {
  // Simulação de renda fixa salva (simulador da Parte 2)
  await page.goto("/renda-fixa/simulador?initialAmount=91&monthlyContribution=200&termValue=12&termUnit=MONTHS&rateMode=CDI_PERCENT&cdiPercent=115&cdiAnnualPercent=12");
  const save = page.getByTestId("fi-sim-save-form");
  await save.getByLabel("Nome").fill("RF para o patrimônio");
  await save.getByRole("button", { name: "Salvar simulação" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("RF para o patrimônio");

  // Simulação do patrimônio total
  await page.goto("/simulador");
  await page.getByRole("link", { name: "Patrimônio total" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Simulação do patrimônio total");
  const form = page.getByTestId("patrimony-form");
  await form.getByLabel("FIIs (simulador bola de neve)").selectOption({ index: 1 });
  await form.getByLabel("Renda fixa (simulador de renda fixa)").selectOption({ label: "RF para o patrimônio" });
  await form.getByRole("button", { name: "Simular patrimônio" }).click();

  const result = page.getByTestId("patrimony-result");
  await expect(result.locator('[data-stat="Patrimônio total final"]')).toContainText("R$");
  await expect(result.locator('[data-stat="FIIs"]')).toContainText("do total");
  await expect(result.locator('[data-stat="Renda fixa"]')).toContainText("do total");
  await expect(page.getByTestId("patrimony-notice")).toContainText("Simulação hipotética");
  await expect(page.getByRole("img", { name: /patrimônio total por classe/ })).toBeVisible();
  const row = page.getByTestId("patrimony-month-1");
  await expect(row).toContainText("FIIs");
  // Total do mês 1 = FIIs + renda fixa
  const cells = (await row.locator("td").allTextContents()).map(norm);
  const brl = (s: string) => Number(s.replace(/[^\d,]/g, "").replace(",", "."));
  expect(brl(cells[3])).toBeCloseTo(brl(cells[1]) + brl(cells[2]), 2);

  // Meta "Patrimônio total" vinculada às duas simulações
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Metas financeiras" }).click();
  const goalForm = page.getByTestId("goal-form");
  // (os formulários de edição usam os mesmos ids; os campos são localizados pelo name)
  await goalForm.locator("[name=name]").fill("Patrimônio de 1 milhão");
  await goalForm.locator("[name=metric]").selectOption("TOTAL_PATRIMONY");
  await goalForm.locator("[name=target]").fill("1000000");
  await goalForm.locator("[name=simulationId]").selectOption({ index: 1 });
  await goalForm.locator("[name=fixedIncomeSimulationId]").selectOption({ label: "RF para o patrimônio" });
  await goalForm.getByRole("button", { name: "Criar meta" }).click();
  const card = page.getByTestId("goal-Patrimônio de 1 milhão");
  await expect(card).toContainText("Patrimônio total (FIIs + renda fixa)");
  await expect(card).toContainText("+ “RF para o patrimônio”");

  // Valor atual da meta = patrimônio total do dashboard
  const goalValue = norm(await card.getByText(/Valor atual:/).textContent());
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Visão geral" }).click();
  const total = norm(await page.getByTestId("overview-patrimony").textContent());
  expect(goalValue).toContain(total);
});
