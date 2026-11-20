/**
 * Cache em memória com expiração (TTL), por processo. Evita consultas
 * repetidas ao provedor dentro da janela de atualização dele. A persistência
 * de longo prazo (última cotação válida) fica no banco.
 */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V, ttlMs: number) {
    if (ttlMs <= 0) return;
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  /** Busca no cache ou executa `load` e guarda o resultado (erros não são guardados). */
  async getOrLoad(key: string, ttlMs: number, load: () => Promise<V>): Promise<{ value: V; cached: boolean }> {
    const hit = this.get(key);
    if (hit !== undefined) return { value: hit, cached: true };
    const value = await load();
    this.set(key, value, ttlMs);
    return { value, cached: false };
  }

  clear() {
    this.store.clear();
  }
}
