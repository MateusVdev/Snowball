/**
 * Cache curto do resultado do health check. A rota /api/health é pública:
 * sem cache, cada acesso (inclusive automatizado, sem login) fazia uma
 * consulta ao banco — dava para gerar carga/custo no banco à vontade.
 * Requisições simultâneas compartilham a mesma consulta em andamento.
 */
export function createHealthCache(check: () => Promise<boolean>, ttlMs = 10_000, now: () => number = Date.now) {
  let last: { at: number; up: boolean } | null = null;
  let inflight: Promise<boolean> | null = null;
  return async function cachedCheck(): Promise<boolean> {
    if (last && now() - last.at < ttlMs) return last.up;
    inflight ??= check()
      .catch(() => false)
      .then((up) => {
        last = { at: now(), up };
        inflight = null;
        return up;
      });
    return inflight;
  };
}
