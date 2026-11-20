import { ProviderError } from "./errors";
import type { RequestLimiter } from "./limiter";

/**
 * GET com timeout, controle de requisições e mapeamento de status HTTP para
 * ProviderError. `fetchImpl` é injetável para testes (respostas simuladas
 * existem SOMENTE nos testes).
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  provider: string;
  limiter: RequestLimiter;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Como interpretar HTTP 403 (padrão: plano sem acesso). */
  forbidden?: { kind: "PLAN_RESTRICTED" | "UNAVAILABLE"; detail?: string };
}

export async function httpGet(
  url: string,
  opts: HttpOptions,
): Promise<{ status: number; body: string; headers: Headers }> {
  if (opts.limiter.pausedUntil) {
    const seconds = Math.ceil((opts.limiter.pausedUntil - Date.now()) / 1000);
    throw new ProviderError("RATE_LIMITED", opts.provider, `Aguarde ${seconds}s.`, seconds);
  }
  return opts.limiter.run(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
    let response: Response;
    try {
      response = await (opts.fetchImpl ?? fetch)(url, {
        method: "GET",
        headers: { Accept: "application/json, text/xml;q=0.9, */*;q=0.5", ...opts.headers },
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      if (controller.signal.aborted) throw new ProviderError("TIMEOUT", opts.provider);
      throw new ProviderError(
        "UNAVAILABLE",
        opts.provider,
        error instanceof Error ? `(${error.message})` : undefined,
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await response.text().catch(() => "");
    const status = response.status;
    if (status === 401) throw new ProviderError("UNAUTHORIZED", opts.provider);
    if (status === 403) {
      throw new ProviderError(opts.forbidden?.kind ?? "PLAN_RESTRICTED", opts.provider, opts.forbidden?.detail);
    }
    if (status === 404) throw new ProviderError("NOT_FOUND", opts.provider);
    if (status === 429) {
      const retry = Number(response.headers.get("retry-after"));
      const seconds = Number.isFinite(retry) && retry > 0 ? retry : 60;
      opts.limiter.pause(seconds);
      throw new ProviderError("RATE_LIMITED", opts.provider, `Aguarde ${seconds}s.`, seconds);
    }
    if (status >= 500) throw new ProviderError("UNAVAILABLE", opts.provider, `(HTTP ${status})`);
    if (status < 200 || status >= 300) {
      throw new ProviderError("INVALID_RESPONSE", opts.provider, `(HTTP ${status})`);
    }
    return { status, body, headers: response.headers };
  });
}

export function parseJson(body: string, provider: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new ProviderError("INVALID_RESPONSE", provider, "(JSON inválido)");
  }
}
