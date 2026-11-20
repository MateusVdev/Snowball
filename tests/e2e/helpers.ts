import { expect, type Page } from "@playwright/test";
import { E2E_USER } from "./fixtures";

export async function login(page: Page, baseURL = "") {
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Texto com espaços normalizados (Intl usa espaço não separável em "R$ 1,00"). */
export function norm(text: string | null) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}
