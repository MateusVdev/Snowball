import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Configuração do Prisma CLI (Prisma 7+).
 * DATABASE_URL vem do ambiente ou do arquivo `.env`.
 * Usamos process.env (e não `env()`) para que `prisma generate` — executado no
 * postinstall — funcione mesmo sem banco configurado; comandos que acessam o
 * banco (migrate, studio) falham com mensagem clara se a variável faltar.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
