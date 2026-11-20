/**
 * Cria o usuário da plataforma (uso individual) ou redefine sua senha.
 *
 *   npm run user:create -- --email voce@exemplo.com --name "Seu Nome"
 *   npm run user:create -- --email voce@exemplo.com --reset-password
 *
 * A senha é lida da variável BDN_PASSWORD ou digitada no terminal (sem eco).
 * Nunca passe a senha como argumento de linha de comando (fica no histórico).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { z } from "zod";
import { createPrismaClient } from "@/server/db/factory";
import { changePassword, createUser } from "@/server/auth/service";
import { emailSchema } from "@/validation/auth";

async function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding as BufferEncoding);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function readPassword(): Promise<string> {
  if (process.env.BDN_PASSWORD) return process.env.BDN_PASSWORD;
  if (!process.stdin.isTTY) {
    throw new Error("Defina BDN_PASSWORD ou execute em um terminal interativo.");
  }
  const first = await promptHidden("Senha: ");
  const second = await promptHidden("Confirme a senha: ");
  if (first !== second) throw new Error("As senhas não conferem.");
  return first;
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      "reset-password": { type: "boolean", default: false },
    },
  });

  const email = emailSchema.parse(values.email);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");
  const db = createPrismaClient(databaseUrl);

  try {
    const existing = await db.user.findUnique({ where: { email } });

    if (values["reset-password"]) {
      if (!existing) throw new Error(`Usuário ${email} não encontrado.`);
      await changePassword(db, existing.id, await readPassword());
      console.log(`Senha redefinida para ${email}. Sessões ativas encerradas.`);
      return;
    }

    if (existing) {
      throw new Error(
        `Usuário ${email} já existe. Use --reset-password para trocar a senha.`,
      );
    }
    if (!values.name) throw new Error("Informe --name.");

    const user = await createUser(db, {
      email,
      name: values.name,
      password: await readPassword(),
    });
    console.log(`Usuário criado: ${user.email} (${user.id})`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof z.ZodError) {
    console.error(error.issues.map((issue) => `- ${issue.message}`).join("\n"));
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
});
