import "server-only";
import { getEnv } from "@/server/env";
import { FundosNetProvider } from "./b3/fundosnet";
import { BcbSgsProvider } from "./bcb/sgs";
import { BrapiProvider } from "./brapi/brapi";
import { TtlCache } from "./cache";
import type {
  AssetInformationProvider,
  DividendProvider,
  IndexRateProvider,
  PriceProvider,
  QuoteData,
} from "./types";

/**
 * Monta os provedores configurados (instâncias únicas por processo, para que
 * limitadores e cache sejam compartilhados entre requisições).
 */
export interface Integrations {
  enabled: boolean;
  price: PriceProvider | null;
  dividends: DividendProvider[];
  assetInfo: AssetInformationProvider | null;
  /** CDI/Selic diários (Banco Central). null quando as integrações estão desligadas. */
  indexRates: IndexRateProvider | null;
  quoteCache: TtlCache<QuoteData>;
  quoteCacheTtlMs: number;
  staleAfterBusinessHours: number;
  /** Para exibição na tela de integrações. */
  status: {
    brapiApiKey: boolean;
    brapiDailyCloseFallback: boolean;
    fundosNetEnabled: boolean;
    cronConfigured: boolean;
  };
}

const globalForIntegrations = globalThis as unknown as { integrations?: Integrations };

export function getIntegrations(): Integrations {
  if (globalForIntegrations.integrations) return globalForIntegrations.integrations;
  const env = getEnv();
  const brapi = new BrapiProvider({
    apiKey: env.BRAPI_API_KEY ?? null,
    dailyCloseFallback: env.BRAPI_DAILY_CLOSE_FALLBACK,
  });
  const dividends: DividendProvider[] = [brapi];
  if (env.FUNDOSNET_ENABLED) dividends.push(new FundosNetProvider());

  const integrations: Integrations = {
    enabled: env.INTEGRATIONS_ENABLED,
    price: env.INTEGRATIONS_ENABLED ? brapi : null,
    dividends: env.INTEGRATIONS_ENABLED ? dividends : [],
    assetInfo: env.INTEGRATIONS_ENABLED ? brapi : null,
    indexRates: env.INTEGRATIONS_ENABLED ? new BcbSgsProvider() : null,
    quoteCache: new TtlCache<QuoteData>(),
    quoteCacheTtlMs: env.QUOTE_CACHE_TTL_SECONDS * 1000,
    staleAfterBusinessHours: env.QUOTE_STALE_AFTER_BUSINESS_HOURS,
    status: {
      brapiApiKey: Boolean(env.BRAPI_API_KEY),
      brapiDailyCloseFallback: env.BRAPI_DAILY_CLOSE_FALLBACK,
      fundosNetEnabled: env.FUNDOSNET_ENABLED,
      cronConfigured: Boolean(env.CRON_SECRET),
    },
  };
  globalForIntegrations.integrations = integrations;
  return integrations;
}
