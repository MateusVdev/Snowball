import type { Database } from "@/server/db/factory";
import { createUserSchema, type CreateUserInput } from "@/validation/auth";
import { getDummyPasswordHash, hashPassword, verifyPassword } from "./password";
import { isLoginRateLimited, rateLimitWindowStart } from "./rate-limit";
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from "./tokens";

/**
 * Serviço de autenticação independente do Next.js.
 * Recebe o banco por parâmetro (injeção de dependência) para ser testável
 * e reutilizável em scripts. A camada Next (cookies/redirects) fica em
 * `session.ts`, `dal.ts` e `actions.ts`.
 */

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; user: PublicUser }
  | { ok: false; reason: "invalid_credentials" | "rate_limited" };

/** Intervalo mínimo entre atualizações de last_used_at (evita escrita a cada request). */
const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

function toPublicUser(user: PublicUser): PublicUser {
  return { id: user.id, email: user.email, name: user.name };
}

export async function createUser(
  db: Database,
  input: CreateUserInput,
): Promise<PublicUser> {
  const data = createUserSchema.parse(input);
  const user = await db.user.create({
    data: {
      email: data.email,
      name: data.name,
      passwordHash: await hashPassword(data.password),
    },
  });
  return toPublicUser(user);
}

/** Troca a senha e encerra todas as sessões do usuário. */
export async function changePassword(
  db: Database,
  userId: string,
  newPassword: string,
): Promise<void> {
  const passwordHash = await hashPassword(
    createUserSchema.shape.password.parse(newPassword),
  );
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash } }),
    db.session.deleteMany({ where: { userId } }),
  ]);
}

export async function login(
  db: Database,
  credentials: { email: string; password: string },
  options: { ttlHours: number; meta?: RequestMeta; now?: Date },
): Promise<LoginResult> {
  const now = options.now ?? new Date();
  const email = credentials.email.trim().toLowerCase();
  const ipAddress = options.meta?.ipAddress ?? null;
  const windowStart = rateLimitWindowStart(now);

  const [byEmail, byIp] = await Promise.all([
    db.loginAttempt.count({
      where: { email, success: false, createdAt: { gte: windowStart } },
    }),
    ipAddress
      ? db.loginAttempt.count({
          where: { ipAddress, success: false, createdAt: { gte: windowStart } },
        })
      : Promise.resolve(0),
  ]);

  if (isLoginRateLimited({ byEmail, byIp })) {
    return { ok: false, reason: "rate_limited" };
  }

  const user = await db.user.findUnique({ where: { email } });
  // Sempre executa a verificação de hash, mesmo sem usuário, para tempo de resposta uniforme.
  const passwordMatches = await verifyPassword(
    credentials.password,
    user?.passwordHash ?? (await getDummyPasswordHash()),
  );
  const success = Boolean(user) && passwordMatches;

  await db.loginAttempt.create({
    data: { email, ipAddress, success, createdAt: now },
  });

  if (!user || !success) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + options.ttlHours * 3600 * 1000);
  await db.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId: user.id,
      expiresAt,
      createdAt: now,
      lastUsedAt: now,
      ipAddress,
      userAgent: options.meta?.userAgent?.slice(0, 512) ?? null,
    },
  });

  return { ok: true, token, expiresAt, user: toPublicUser(user) };
}

/** Valida um token de sessão e devolve o usuário (ou null se inválido/expirado). */
export async function validateSessionToken(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<PublicUser | null> {
  if (!isWellFormedSessionToken(token)) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= now.getTime()) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (
    now.getTime() - session.lastUsedAt.getTime() >
    LAST_USED_UPDATE_INTERVAL_MS
  ) {
    await db.session.updateMany({
      where: { id: session.id },
      data: { lastUsedAt: now },
    });
  }

  return toPublicUser(session.user);
}

/** Encerra a sessão associada ao token (idempotente). */
export async function revokeSession(db: Database, token: string) {
  if (!isWellFormedSessionToken(token)) return;
  await db.session.deleteMany({
    where: { tokenHash: hashSessionToken(token) },
  });
}

/** Limpeza de dados expirados — pode ser agendada futuramente. */
export async function purgeExpiredAuthData(
  db: Database,
  now: Date = new Date(),
  attemptsRetentionDays = 90,
) {
  const attemptsCutoff = new Date(
    now.getTime() - attemptsRetentionDays * 24 * 3600 * 1000,
  );
  const [sessions, attempts] = await db.$transaction([
    db.session.deleteMany({ where: { expiresAt: { lte: now } } }),
    db.loginAttempt.deleteMany({ where: { createdAt: { lt: attemptsCutoff } } }),
  ]);
  return { sessions: sessions.count, attempts: attempts.count };
}

/** Confere a senha atual de um usuário (mesmo custo quando não existe). */
export async function verifyUserPassword(db: Database, userId: string, password: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyPasswordHash()));
  return Boolean(user) && ok;
}

export async function listUserSessions(db: Database, userId: string, now: Date = new Date()) {
  return db.session.findMany({
    where: { userId, expiresAt: { gt: now } },
    select: { id: true, tokenHash: true, createdAt: true, lastUsedAt: true, expiresAt: true, userAgent: true, ipAddress: true },
    orderBy: { lastUsedAt: "desc" },
  });
}

/** Encerra todas as sessões do usuário exceto a do token informado. */
export async function revokeOtherSessions(db: Database, userId: string, currentToken: string) {
  const r = await db.session.deleteMany({
    where: { userId, NOT: { tokenHash: hashSessionToken(currentToken) } },
  });
  return r.count;
}
