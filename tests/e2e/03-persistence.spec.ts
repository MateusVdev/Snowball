import { spawn, type ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { login, norm } from "./helpers";

/**
 * Persistência após reiniciar o sistema: sobe um servidor de produção
 * PRÓPRIO, lê a carteira, encerra o processo, sobe outro e confere que os
 * dados (e a sessão, guardada no banco) continuam lá.
 * Depende do estado deixado por 02-portfolio.spec.ts (MXRF11 com 21 cotas).
 */
const PORT = 3101;
const BASE = `http://localhost:${PORT}`;

async function startServer(): Promise<ChildProcess> {
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "ignore",
    detached: true,
  });
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return child;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Servidor não subiu a tempo.");
}

async function isUp() {
  try {
    await fetch(`${BASE}/api/health`);
    return true;
  } catch {
    return false;
  }
}

/** Encerra o grupo de processos: SIGTERM e, se não sair em 5 s, SIGKILL. */
async function stopServer(child: ChildProcess) {
  if (!child.pid) return;
  for (const [signal, attempts] of [["SIGTERM", 20], ["SIGKILL", 40]] as const) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      return; // já encerrado
    }
    for (let i = 0; i < attempts; i++) {
      if (!(await isUp())) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("Servidor não encerrou.");
}

test("10. dados e sessão persistem após reiniciar o servidor", async ({ page }) => {
  test.setTimeout(90_000);
  const readPosition = async () => {
    await page.goto(`${BASE}/carteira/MXRF11`);
    return {
      qty: norm(await page.locator('[data-stat="Quantidade de cotas"]').textContent()),
      avg: norm(await page.locator('[data-stat="Preço médio"]').textContent()),
      realized: norm(await page.locator('[data-stat="Resultado realizado"]').textContent()),
    };
  };

  let server = await startServer();
  try {
    await login(page, BASE);
    const before = await readPosition();
    expect(before.qty).toContain("21");
    await stopServer(server);

    server = await startServer();
    const after = await readPosition(); // mesma sessão (cookie) após o reinício
    await expect(page).toHaveURL(`${BASE}/carteira/MXRF11`);
    expect(after).toEqual(before);
  } finally {
    await stopServer(server).catch(() => undefined);
  }
});
