import { execSync } from "node:child_process";
import { createUser } from "@/server/auth/service";
import { createTestDb, resetDatabase } from "../support/db";
import { loadTestEnv } from "../support/load-test-env";
import { E2E_USER } from "./fixtures";

/** Migra e limpa o banco de teste e cria o usuário usado nos testes E2E. */
export default async function globalSetup() {
  const url = loadTestEnv();
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  const db = createTestDb();
  try {
    await resetDatabase(db);
    await createUser(db, E2E_USER);
  } finally {
    await db.$disconnect();
  }
}
