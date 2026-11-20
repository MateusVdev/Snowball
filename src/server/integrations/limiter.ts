/**
 * Controle de requisições por provedor (em memória, por processo):
 * - limite de requisições simultâneas;
 * - intervalo mínimo entre inícios de requisição;
 * - pausa após HTTP 429, respeitando Retry-After.
 */
export class RequestLimiter {
  private active = 0;
  private queue: (() => void)[] = [];
  private lastStart = 0;
  private blockedUntil = 0;

  constructor(
    private readonly opts: { maxConcurrent: number; minIntervalMs: number },
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Momento até o qual o provedor está em pausa (0 = livre). */
  get pausedUntil() {
    return this.blockedUntil > this.now() ? this.blockedUntil : 0;
  }

  pause(seconds: number) {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + seconds * 1000);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.opts.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      const wait = Math.max(0, this.lastStart + this.opts.minIntervalMs - this.now());
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
      return await task();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}
