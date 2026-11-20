import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Carrega `.env.test` com prioridade sobre o ambiente. Garante que os testes
 * de integração nunca usem o banco de desenvolvimento por engano.
 */
export function loadTestEnv() {
  const path = resolve(process.cwd(), ".env.test");
  if (!existsSync(path)) {
    throw new Error(
      "Arquivo .env.test não encontrado. Crie-o a partir de .env.example apontando para um banco de TESTE.",
    );
  }
  config({ path, override: true, quiet: true });
  const url = process.env.DATABASE_URL ?? "";
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(
      "Por segurança, o DATABASE_URL de teste deve apontar para um banco cujo nome contenha 'test'.",
    );
  }
  return url;
}

loadTestEnv();
