import { z } from "zod";

/** Normalização única de e-mail: usada no login, no cadastro e no rate limit. */
export const emailSchema = z
  .string({ error: "Informe o e-mail." })
  .trim()
  .toLowerCase()
  .max(254, "E-mail muito longo.")
  .pipe(z.email({ error: "E-mail inválido." }));

/** Login: só exige preenchimento; o limite superior evita abuso de CPU no hash. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: "Informe a senha." })
    .min(1, "Informe a senha.")
    .max(256, "Senha muito longa."),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Política de senha para criação/troca de senha. */
export const newPasswordSchema = z
  .string()
  .min(12, "A senha deve ter pelo menos 12 caracteres.")
  .max(256, "A senha deve ter no máximo 256 caracteres.")
  .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), {
    message: "A senha deve conter letras e números.",
  });

export const createUserSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1, "Informe o nome.").max(100),
  password: newPasswordSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;
