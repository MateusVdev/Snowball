/**
 * Contratos dos provedores externos. O restante do sistema depende apenas
 * destas interfaces — nunca de um provedor específico — para que fontes
 * possam ser adicionadas ou trocadas.
 *
 * Regras para qualquer implementação:
 * - Valores numéricos saem como string decimal (nunca number) e já validados.
 * - Ausência de dado = campo null; nunca zero ou valor inventado.
 * - Falhas são lançadas como ProviderError (ver errors.ts).
 */

export interface ProviderInfo {
  /** Identificador estável (gravado no banco como origem). */
  id: "BRAPI" | "B3_FUNDOSNET";
  name: string;
}

export interface QuoteData {
  ticker: string;
  /** Preço (string decimal > 0). */
  price: string;
  previousClose: string | null;
  change: string | null;
  /** Em pontos percentuais (-1.16 = -1,16%). */
  changePercent: string | null;
  /** Instante a que o preço se refere, segundo o provedor. */
  marketTime: Date;
  /** "QUOTE" = cotação atual do provedor; "DAILY_CLOSE" = último fechamento do histórico. */
  kind: "QUOTE" | "DAILY_CLOSE";
  currency: string | null;
}

export interface DailyPriceData {
  /** Data do pregão (meia-noite UTC). */
  date: Date;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string;
  adjustedClose: string | null;
  volume: string | null;
}

export interface PriceProvider extends ProviderInfo {
  getQuote(ticker: string): Promise<QuoteData>;
  /** Histórico diário, se o plano/fonte disponibilizar. */
  getDailyHistory?(ticker: string, from: Date, to: Date): Promise<DailyPriceData[]>;
}

export interface DividendData {
  ticker: string;
  type: "INCOME" | "AMORTIZATION";
  /** Valor por cota pago na data (sem ajuste). */
  ratePerShare: string;
  dataCom: Date;
  paymentDate: Date | null;
  approvedOn: Date | null;
  referenceLabel: string | null;
  /** Conferido em documento oficial, quando a fonte informa. */
  verified: boolean | null;
  externalId: string | null;
  remarks: string | null;
}

export interface DividendQuery {
  ticker: string;
  /** CNPJ (14 dígitos), exigido por fontes oficiais como o FundosNET. */
  cnpj: string | null;
  /** Data de pagamento inicial desejada. */
  from: Date;
  /** Identificadores já importados (permite à fonte evitar downloads repetidos). */
  knownExternalIds?: ReadonlySet<string>;
}

export interface DividendProvider extends ProviderInfo {
  /** true quando o provedor exige CNPJ (o fundo precisa tê-lo cadastrado). */
  requiresCnpj: boolean;
  getDividends(query: DividendQuery): Promise<DividendData[]>;
}

export interface AssetInformation {
  ticker: string;
  name: string | null;
  cnpj: string | null;
  /** Segmento como informado pela fonte (ex.: segmento de atuação na CVM). */
  segment: string | null;
  /** Classificação adicional da fonte (ex.: "papel", "tijolo"). */
  segmentType: string | null;
  administrator: string | null;
}

export interface AssetInformationProvider extends ProviderInfo {
  getAssetInfo(ticker: string): Promise<AssetInformation>;
}
