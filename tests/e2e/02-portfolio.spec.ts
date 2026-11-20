import { expect, test, type Page } from "@playwright/test";
import { login, norm } from "./helpers";

/**
 * Fluxo completo da carteira pela interface, com valores conferidos à mão.
 * Os testes são sequenciais (cada um parte do estado deixado pelo anterior).
 */
test.describe.configure({ mode: "serial" });

const stat = async (page: Page, label: string) =>
  norm(await page.locator(`[data-stat="${label}"]`).textContent());

async function submit(page: Page, formTestId: string) {
  await page.locator(`[data-testid=${formTestId}] button[type=submit]`).click();
}

async function addFund(page: Page, ticker: string, qty: string, avg: string, quote: string) {
  await page.goto("/carteira/novo");
  await page.getByLabel("Ticker").fill(ticker);
  await page.getByLabel("Informar saldo inicial").check();
  await page.getByLabel("Quantidade de cotas").fill(qty);
  await page.getByLabel("Preço médio (R$)").fill(avg);
  await page.getByLabel("Cotação de referência (R$)").fill(quote);
  await submit(page, "create-fund-form");
  await expect(page).toHaveURL(new RegExp(`/carteira/${ticker}$`));
}

async function trade(
  page: Page,
  ticker: string,
  type: "BUY" | "SELL",
  date: string,
  qty: string,
  price: string,
  fees: string,
) {
  await page.goto(`/operacoes/nova?fundo=${ticker}&tipo=${type}`);
  await page.getByLabel("Data da operação").fill(date);
  await page.getByLabel("Quantidade de cotas").fill(qty);
  await page.getByLabel("Preço unitário (R$)").fill(price);
  await page.getByLabel("Taxas (R$)").fill(fees);
  await submit(page, "trade-form");
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("1. cadastra a carteira inicial informada (saldo inicial + cotação manual)", async ({ page }) => {
  await addFund(page, "MXRF11", "31", "8,44", "8,52");
  expect(await stat(page, "Quantidade de cotas")).toContain("31");
  expect(await stat(page, "Preço médio")).toContain("R$ 8,44");
  expect(await stat(page, "Capital investido")).toContain("R$ 261,64");
  expect(await stat(page, "Cotação atual")).toContain("R$ 8,52");
  expect(await stat(page, "Cotação atual")).toContain("Manual");
  expect(await stat(page, "Valor atual")).toContain("R$ 264,12");
  expect(await stat(page, "Resultado não realizado")).toContain("+R$ 2,48");
  expect(await stat(page, "Rentabilidade")).toContain("+0,95%");
  // Saldo inicial sem data inventada.
  await expect(page.getByRole("cell", { name: "Sem data" })).toBeVisible();

  await addFund(page, "HGLG11", "1", "145,00", "141,80");
  expect(await stat(page, "Resultado não realizado")).toContain("-R$ 3,20");
  expect(await stat(page, "Rentabilidade")).toContain("-2,21%");

  await page.goto("/carteira");
  expect(await stat(page, "Capital investido")).toContain("R$ 406,64");
  expect(await stat(page, "Valor atual")).toContain("R$ 405,92");
  expect(await stat(page, "Resultado não realizado")).toContain("-R$ 0,72");
  expect(await stat(page, "Resultado não realizado")).toContain("-0,18%");
});

test("2. impede ticker duplicado e pesquisa por ticker", async ({ page }) => {
  await page.goto("/carteira/novo");
  await page.getByLabel("Ticker").fill("mxrf11");
  await submit(page, "create-fund-form");
  await expect(page.getByTestId("form-error")).toContainText("MXRF11 já está cadastrado");

  await page.goto("/carteira?q=hg");
  await expect(page.getByTestId("position-HGLG11")).toBeVisible();
  await expect(page.getByTestId("position-MXRF11")).toHaveCount(0);
});

test("3. compra com taxas recalcula o preço médio", async ({ page }) => {
  // 10 × 8,50 + 0,30 = 85,30 → C = 346,94; Q = 41; PM = 8,46195122
  await trade(page, "MXRF11", "BUY", "2026-02-02", "10", "8,50", "0,30");
  await expect(page).toHaveURL(/\/carteira\/MXRF11$/);
  expect(await stat(page, "Quantidade de cotas")).toContain("41");
  expect(await stat(page, "Preço médio")).toContain("R$ 8,46195122");
  expect(await stat(page, "Capital investido")).toContain("R$ 346,94");
});

test("4. venda acima do saldo é rejeitada e preserva o formulário", async ({ page }) => {
  await trade(page, "MXRF11", "SELL", "2026-03-05", "42", "8,60", "0,40");
  await expect(page.getByTestId("form-error")).toContainText("Quantidade insuficiente");
  await expect(page.getByLabel("Quantidade de cotas")).toHaveValue("42");
});

test("5. venda usa o PM anterior, registra resultado realizado e não altera o PM", async ({ page }) => {
  // Custo vendido = 346,94 × 20/41 = 169,2390… ; líquido = 172,00 − 0,40 = 171,60
  // Realizado = 2,3609… → +R$ 2,36 ; restante: Q = 21, C = 177,70 ; PM inalterado
  await trade(page, "MXRF11", "SELL", "2026-03-05", "20", "8,60", "0,40");
  await expect(page).toHaveURL(/\/carteira\/MXRF11$/);
  expect(await stat(page, "Quantidade de cotas")).toContain("21");
  expect(await stat(page, "Preço médio")).toContain("R$ 8,46195122");
  expect(await stat(page, "Capital investido")).toContain("R$ 177,70");
  expect(await stat(page, "Resultado realizado")).toContain("+R$ 2,36");
  // Não realizado: 21 × 8,52 = 178,92 − 177,7009… = 1,2190… → +R$ 1,22
  expect(await stat(page, "Resultado não realizado")).toContain("+R$ 1,22");
});

test("6. corrige a compra com rastreabilidade e recalcula a venda posterior", async ({ page }) => {
  await page.goto("/operacoes?fundo=MXRF11&tipo=BUY");
  await page.getByRole("link", { name: "Detalhes" }).first().click();
  await page.getByLabel("Taxas (R$)").fill("0,50");
  await page.getByLabel("Motivo da correção").fill("Taxa conferida na nota de corretagem");
  await submit(page, "correct-form");
  await expect(page.getByText("Esta operação corrige")).toBeVisible();

  // Compra: C = 261,64 + 85,50 = 347,14 ; PM = 8,46682927
  // Venda: custo = 347,14 × 20/41 = 169,3365… ; realizado = 2,2634… → +R$ 2,26
  await page.goto("/carteira/MXRF11");
  expect(await stat(page, "Preço médio")).toContain("R$ 8,46682927");
  expect(await stat(page, "Resultado realizado")).toContain("+R$ 2,26");
  expect(await stat(page, "Capital investido")).toContain("R$ 177,80");

  // A original continua no histórico, marcada como corrigida.
  await page.goto("/operacoes?fundo=MXRF11&status=all");
  await expect(page.getByText("Corrigida", { exact: true })).toHaveCount(1);
  await expect(page.locator("tbody tr")).toHaveCount(4);
});

test("7. cancelamento exige motivo; filtros por período", async ({ page }) => {
  await page.goto("/operacoes?fundo=MXRF11&tipo=SELL");
  await page.getByRole("link", { name: "Detalhes" }).click();
  await page.getByLabel("Motivo do cancelamento").fill("x");
  await submit(page, "cancel-form");
  await expect(page.getByText("mínimo de 5 caracteres")).toBeVisible();

  await page.goto("/operacoes?de=2026-03-01&ate=2026-03-31");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("Venda");
});

test("8. remoção exige posição zerada", async ({ page }) => {
  await page.goto("/carteira/HGLG11/editar");
  await expect(page.getByText("Registre a venda")).toBeVisible();
  await expect(page.getByTestId("archive-form")).toHaveCount(0);
});
