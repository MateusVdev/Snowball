import { expect, test } from "@playwright/test";
import pg from "pg";
import { login } from "./helpers";
import { loadTestEnv } from "../support/load-test-env";

/**
 * "Quanto rende": o E2E roda com integrações desligadas, então as taxas do CDI
 * são gravadas diretamente no banco de TESTE (0,05% ao dia nos últimos 40 dias).
 * A Caixinha Turbo (R$ 91, 115% do CDI) foi cadastrada no spec 07, hoje:
 * por dia útil = 91 × 0,05% × 1,15 = R$ 0,05 bruto (líquido 22,5% IR = R$ 0,04).
 */
test.beforeAll(async () => {
  const client = new pg.Client({ connectionString: loadTestEnv() });
  await client.connect();
  try {
    await client.query(`INSERT INTO index_daily_rates (indexer, date, daily_rate_percent, fetched_at)
      SELECT 'CDI', d::date, 0.05, now() FROM generate_series(current_date - 40, current_date, interval '1 day') d
      WHERE extract(isodow FROM d) < 6 ON CONFLICT DO NOTHING`);
  } finally {
    await client.end();
  }
});

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("detalhe, lista e dashboard mostram quanto a renda fixa rende, como estimativa", async ({ page }) => {
  await page.goto("/renda-fixa");
  const total = page.getByTestId("yield-estimate");
  await expect(total).toContainText("Quanto a renda fixa rende");
  await expect(total).toContainText("Estimativa com base na última taxa do CDI/Selic");
  await expect(total.getByTestId("yield-day")).toContainText("R$ 0,05");
  await expect(total.getByTestId("yield-day")).toContainText("R$ 0,04");
  await expect(page.getByTestId("fixed-income-table").getByRole("row", { name: /Caixinha Turbo/ })).toContainText("R$ 0,05");

  await page.getByRole("link", { name: "Caixinha Turbo" }).click();
  const card = page.getByTestId("yield-estimate");
  await expect(card).toContainText("Quanto rende (estimativa)");
  await expect(card).toContainText("Não inclui IOF");
  await expect(card.getByTestId("yield-day")).toContainText("R$ 0,05");
  await expect(card.getByTestId("yield-month")).toBeVisible();
  await expect(card.getByTestId("yield-projection")).toContainText("Projeção do mês inteiro");

  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Visão geral" }).click();
  const dash = page.getByTestId("dashboard-fixed-income");
  await expect(dash).toContainText("Renda fixa");
  await expect(dash).toContainText("Estimativa com base na última taxa do CDI/Selic");
  await expect(dash.getByTestId("yield-day")).toContainText("R$ 0,05");
  await expect(dash.getByTestId("yield-projection")).toBeVisible();
});
