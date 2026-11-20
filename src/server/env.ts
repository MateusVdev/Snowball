import { z } from "zod";

/**
 * Validação centralizada das variáveis de ambiente do servidor.
 * Falha cedo (na primeira leitura) com mensagem clara caso algo esteja ausente
 * ou inválido. Nunca importar este módulo em Client Components.
 */
const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL é obrigatória")
    .refine(
      (value) =>
        value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL deve ser uma URL PostgreSQL",
    ),
  /** Duração da sessão em horas (padrão: 7 dias). */
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  /** Força o atributo Secure do cookie. Padrão: true em produção. */
  SESSION_COOKIE_SECURE: booleanFromString.optional(),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Usado apenas em testes para reavaliar process.env. */
export function resetEnvCache() {
  cached = undefined;
}
