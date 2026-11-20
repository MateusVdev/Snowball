/**
 * Diagnóstico das integrações REAIS (não grava nada no banco):
 *
 *   npm run integrations:check -- MXRF11 HGLG11 [--cnpj MXRF11=97521225000125]
 *
 * Usa BRAPI_API_KEY do .env, se existir. Mostra o que cada provedor
 * realmente retorna para os tickers informados.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { BrapiProvider } from "@/server/integrations/brapi/brapi";
import { FundosNetProvider } from "@/server/integrations/b3/fundosnet";
import { isProviderError } from "@/server/integrations/errors";

async function attempt<T>(label: string, fn: () => Promise<T>) {
  try {
    const value = await fn();
    console.log(`  ✔ ${label}`);
    return value;
  } catch (error) {
    console.log(`  ✖ ${label}: ${isProviderError(error) ? `${error.kind} — ${error.message}` : String(error)}`);
    return null;
  }
}

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { cnpj: { type: "string", multiple: true } } });
  const tickers = positionals.length ? positionals.map((t) => t.toUpperCase()) : ["MXRF11", "HGLG11"];
  const cnpjs = new Map((values.cnpj ?? []).map((p) => p.split("=") as [string, string]));
  const brapi = new BrapiProvider({ apiKey: process.env.BRAPI_API_KEY || null });
  const fnet = new FundosNetProvider({ maxDocuments: 3 });
  console.log(`brapi: ${brapi.hasApiKey ? "com chave" : "sem chave (dados públicos de teste)"}`);
  const from = new Date(Date.now() - 400 * 24 * 3600 * 1000);

  for (const ticker of tickers) {
    console.log(`\n== ${ticker}`);
    const q = await attempt("cotação", () => brapi.getQuote(ticker));
    if (q) console.log(`     R$ ${q.price} (${q.kind}) em ${q.marketTime.toISOString()} · anterior ${q.previousClose} · var ${q.changePercent}%`);
    const info = await attempt("dados cadastrais", () => brapi.getAssetInfo(ticker));
    if (info) console.log(`     ${info.name} · CNPJ ${info.cnpj} · segmento "${info.segment}" · tipo "${info.segmentType}"`);
    const divs = await attempt("proventos (brapi)", () => brapi.getDividends({ ticker, cnpj: null, from }));
    if (divs) for (const d of divs.slice(-3)) console.log(`     ${d.type} ${d.ratePerShare} · data-com ${d.dataCom.toISOString().slice(0, 10)} · pgto ${d.paymentDate?.toISOString().slice(0, 10)} · ${d.referenceLabel}`);
    const cnpj = cnpjs.get(ticker) ?? info?.cnpj ?? null;
    const official = await attempt(`documentos oficiais B3 FundosNET (CNPJ ${cnpj ?? "—"})`, () => fnet.getDividends({ ticker, cnpj, from: new Date(Date.now() - 70 * 24 * 3600 * 1000) }));
    if (official) for (const d of official) console.log(`     ${d.type} ${d.ratePerShare} · data-com ${d.dataCom.toISOString().slice(0, 10)} · pgto ${d.paymentDate?.toISOString().slice(0, 10)} · ${d.referenceLabel} · ${d.externalId}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
