import { expect, test, type Page } from "@playwright/test";
import { login, norm } from "./helpers";

/**
 * Proventos pela interface (integrações desligadas: nenhum dado externo).
 * Usa o estado deixado pelos specs anteriores: MXRF11 com saldo inicial
 * registrado HOJE (21 cotas após operações) e HGLG11 com 1 cota.
 */
test.describe.configure({ mode: "serial" });

const stat = async (page: Page, label: string) => norm(await page.locator(`[data-stat="${label}"]`).textContent());

async function registerDividend(
  page: Page,
  opts: { ticker: string; kind?: string; rate: string; dataCom: string; payment: string; competence?: string },
  expectOk = true,
) {
  await page.goto(`/proventos/novo?fundo=${opts.ticker}`);
  if (opts.kind) await page.getByLabel("Natureza").selectOption(opts.kind);
  await page.getByLabel("Valor por cota (R$)").fill(opts.rate);
  await page.getByLabel("Data-com (data-base)").fill(opts.dataCom);
  await page.getByLabel("Data de pagamento (opcional)").fill(opts.payment);
  if (opts.competence) await page.getByLabel("Competência (opcional)").fill(opts.competence);
  await page.locator("[data-testid=dividend-form] button[type=submit]").click();
  if (expectOk) await expect(page).toHaveURL(/\/proventos\/(?!novo)[a-z0-9]+$/);
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("sem anúncio: 'Aguardando divulgação.'", async ({ page }) => {
  await page.goto("/proventos");
  await expect(page.getByTestId("upcoming-HGLG11")).toContainText("Aguardando divulgação.");
});

test("cadastro manual, duplicidade evitada e elegibilidade desconhecida antes do saldo inicial", async ({ page }) => {
  // Data-com no passado distante: o saldo inicial (sem data) foi registrado hoje → elegibilidade desconhecida
  await registerDividend(page, { ticker: "HGLG11", rate: "1,17", dataCom: "2020-10-30", payment: "2020-11-16", competence: "2020-10" });
  await expect(page.getByText("Desconhecida:")).toBeVisible();

  await registerDividend(page, { ticker: "HGLG11", rate: "1,17", dataCom: "2020-10-30", payment: "2020-11-16" }, false);
  await expect(page.getByTestId("form-error")).toContainText("Duplicidade evitada");
});

test("recebimento com quantidade informada; pagamento duplicado impossível", async ({ page }) => {
  await page.goto("/proventos?fundo=HGLG11");
  await page.getByRole("link", { name: "Detalhes" }).last().click();
  // Sem informar a quantidade: o sistema não supõe
  await page.locator("[data-testid=receipt-form] button[type=submit]").click();
  await expect(page.getByTestId("form-error")).toContainText("Quantidade elegível desconhecida");
  await page.getByLabel("Quantidade elegível (opcional)").fill("1");
  await page.locator("[data-testid=receipt-form] button[type=submit]").click();
  await expect(page.getByText("Recebido e registrado").first()).toBeVisible();
  await expect(page.getByTestId("receipt-form")).toHaveCount(0); // não dá para registrar de novo

  await page.goto("/proventos");
  // 1 × 1,17 = 1,17 recebido em 2020
  expect(await stat(page, "Total recebido")).toContain("R$ 1,17");
});

test("anunciado (futuro) com valor esperado pela posição; previsão separada", async ({ page }) => {
  // Data-com futura: posição atual conhecida (1 cota HGLG11) → esperado 1 × 1,20
  await registerDividend(page, { ticker: "HGLG11", rate: "1,20", dataCom: "2099-01-30", payment: "2099-02-13" });
  await registerDividend(page, { ticker: "MXRF11", kind: "FORECAST", rate: "0,10", dataCom: "2099-01-30", payment: "2099-02-13" });
  await page.goto("/proventos");
  const hglg = page.getByTestId("upcoming-HGLG11");
  await expect(hglg).toContainText("R$ 1,20");
  await expect(hglg).toContainText("R$ 1,20 para 1 cota(s)");
  const mxrf = page.getByTestId("upcoming-MXRF11");
  await expect(mxrf).toContainText("Aguardando divulgação.");
  await expect(mxrf).toContainText("(estimativa)");
});
