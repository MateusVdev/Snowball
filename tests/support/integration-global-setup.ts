import { execSync } from "node:child_process";
import { loadTestEnv } from "./load-test-env";

/** Aplica as migrações no banco de teste antes da suíte de integração. */
export default function setup() {
  const url = loadTestEnv();
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
