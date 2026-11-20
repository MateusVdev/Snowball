# Integrações externas — Bola de Neve

Pesquisa feita em 20/11/2026, consultando a documentação oficial e fazendo
chamadas reais. Preços e limites de terceiros mudam: confira as fontes antes
de contratar um plano.

## Arquitetura

O sistema depende apenas de três interfaces (`src/server/integrations/types.ts`):

| Interface | Responsabilidade | Implementações |
| --------- | ---------------- | -------------- |
| `PriceProvider` | cotação atual (`getQuote`) e histórico diário opcional (`getDailyHistory`) | `BrapiProvider` |
| `DividendProvider` | proventos (rendimentos e amortizações) por ticker/CNPJ | `BrapiProvider`, `FundosNetProvider` (B3) |
| `AssetInformationProvider` | dados cadastrais (nome, CNPJ, segmento) | `BrapiProvider` |

- `registry.ts` monta os provedores a partir das variáveis de ambiente (instâncias únicas por processo).
- Serviços recebem os provedores por parâmetro, então trocar ou adicionar uma fonte não altera o resto do sistema.
- `http.ts` centraliza: timeout, `AbortController` e mapeamento HTTP → `ProviderError` (`UNAUTHORIZED`, `PLAN_RESTRICTED`, `NOT_FOUND`, `RATE_LIMITED`, `UNAVAILABLE`, `TIMEOUT`, `INVALID_RESPONSE`, `NOT_CONFIGURED`).
- `limiter.ts`: controle de requisições por provedor (simultâneas, intervalo mínimo, pausa após 429 com `Retry-After`).
- `cache.ts`: cache em memória com TTL para cotações (`QUOTE_CACHE_TTL_SECONDS`).
- Toda resposta é validada com Zod; valores saem como string decimal; dado ausente vira `null`, nunca zero.

## brapi (https://brapi.dev)

Documentação consultada: `https://brapi.dev/llms.txt`, `https://brapi.dev/openapi.json`,
`/docs/authentication.mdx`, `/docs/acoes/cotacao.mdx`, `/docs/fiis/dividendos.mdx`,
`/docs/fiis/historico.mdx`, `/docs/fiis/indicadores.mdx`, `/docs/fiis/listagem.mdx`,
`/pricing.md`.

### Endpoints usados

| Endpoint | Uso | Campos aproveitados |
| -------- | --- | ------------------- |
| `GET /api/v2/stocks/quote?symbols=` | cotação atual | `regularMarketPrice`, `regularMarketPreviousClose`, `regularMarketChange`, `regularMarketChangePercent`, `regularMarketTime`, `currency` |
| `GET /api/v2/fii/historical?symbols=&startDate=&endDate=` | fechamentos diários | `date` (epoch s), `open`, `high`, `low`, `close`, `adjustedClose`, `volume` |
| `GET /api/v2/fii/dividends?symbols=&startDate=` | proventos | `label` (RENDIMENTO/AMORTIZAÇÃO), `rawRate` (valor pago na data), `lastDatePrior` (data-com), `paymentDate`, `approvedOn`, `relatedTo`, `isinCode`, `verified`, `remarks` |
| `GET /api/v2/fii/list?symbols=` | dados cadastrais | `name`, `cnpj`, `segmentoAtuacao`, `segmentType`, `administratorName` |

### Autenticação e limites (documentação oficial)

- Header `Authorization: Bearer <BRAPI_API_KEY>`. Chave criada em https://brapi.dev/dashboard.
- Sem chave: só os tickers de teste. Na prática (verificado):
  - `stocks/quote` **não** responde para MXRF11/HGLG11 sem chave (401). Responde só para PETR4, MGLU3, VALE3 e ITUB4.
  - `fii/historical`, `fii/dividends`, `fii/list` e `fii/indicators` respondem sem chave **apenas** para MXRF11 e HGLG11.
  - Outros FIIs (ex.: KNRI11) → 401.
  - Limite sem chave: 20 requisições/minuto por IP.
- Planos (página `pricing.md`, atualizada em 16/09/2026):

| Plano | Requisições/mês | Ativos por requisição | Histórico | Atualização | Requisições simultâneas |
| ----- | --------------- | --------------------- | --------- | ----------- | ----------------------- |
| Gratuito | 15.000 | 1 | até 3 meses | 30 min | 1 |
| Startup | 150.000 | 10 | até 1 ano | 15 min | 4 |
| Pro | 500.000 | 20 | 10+ anos | 5 min | 16 |

- Os endpoints `fii/dividends`, `fii/historical`, `fii/list` e `fii/indicators` são do **plano Pro**. O plano Gratuito tem cotações de FII "para teste" e proventos "limitados".
- Respostas trazem `RateLimit-Limit/Remaining/Reset`. 429 traz `Retry-After`.

### Particularidades encontradas

- Datas chegam como meia-noite de Brasília em UTC (`2026-10-30T03:00:00.000Z`) e são convertidas para a data de calendário de São Paulo.
- `relatedTo` é texto livre ("Outubro-2026", mas às vezes "OUTUBRO" sem ano). Só vira competência quando há ano; nunca suponho o ano.
- Os dados cadastrais podem divergir entre campos. Exemplo: para o MXRF11, `segmentoAtuacao` = "Logística" (o mesmo segmento declarado à CVM no informe mensal) e `segmentType` = "papel". Por isso os dados cadastrais são **sugestões** que o usuário aplica campo a campo.
- No plano gratuito/sandbox, o último fechamento disponível pode estar 1 pregão atrasado. A cotação aparece então como "Desatualizada" — e é verdade.

### Cotação sem chave (fallback)

Quando `stocks/quote` responde 401/403 e `BRAPI_DAILY_CLOSE_FALLBACK=true` (padrão), o provedor usa o **último fechamento** de `fii/historical`.

- Ela é gravada com origem `BRAPI_DAILY_CLOSE` e exibida como "Fechamento · brapi", nunca como cotação em tempo real.
- A variação do dia, nesse caso, é calculada entre os dois últimos fechamentos.

## B3 FundosNET (https://fnet.bmfbovespa.com.br) — fonte oficial

É o sistema onde os administradores publicam os documentos dos fundos. Usamos
a categoria **"Aviso aos Cotistas – Estruturado" / tipo "Rendimentos e
Amortizações"** (categoria 14, tipo 41).

- Busca: `GET /fnet/publico/pesquisarGerenciadorDocumentosDados?cnpjFundo=…&idCategoriaDocumento=14&idTipoDocumento=41…`, que devolve uma lista JSON (id, status, data de referência, data de entrega).
- Documento: `GET /fnet/publico/downloadDocumento?id=…` devolve um XML.

O XML traz `DataBase` (data-com), `ValorProvento` (até 9 casas), `DataPagamento`,
`PeriodoReferencia`, `CodISIN` e `CodNegociacao`, dentro de `<Rendimento>` ou
`<Amortizacao tipo="Total|Parcial">`.

Limitações:

- **Exige o CNPJ do fundo.** Ele pode ser cadastrado na edição do fundo ou aplicado a partir da sugestão da brapi.
- Não é uma API pública documentada: são as mesmas consultas da página pública, sem chave.
- O site usa **proteção anti-robô (Cloudflare)** e bloqueou rajadas durante os testes: respondeu 403 ou uma página HTML "Attention Required". Por isso o provedor:
  - faz 1 requisição por vez, com intervalo de 5 s;
  - consulta no máximo 6 documentos;
  - não baixa de novo documentos já importados;
  - trata 403/HTML como **indisponibilidade**, nunca como dado.
- Considera apenas documentos com status "AC" (ativo). Documentos cancelados e inativos são ignorados.

Verificado em 20/11/2026:

| Fundo | Data-com | Pagamento | Rendimento | Fonte |
| ----- | -------- | --------- | ---------- | ----- |
| MXRF11 | 30/10/2026 | 16/11/2026 | R$ 0,095 | documento 1365016 |
| HGLG11 | 30/10/2026 | 16/11/2026 | R$ 1,17 | documento oficial |

Os valores coincidem com a brapi.

## CVM — dados abertos (avaliada, não usada)

`https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/` traz os informes mensais dos FIIs.

- O arquivo complementar traz apenas **percentuais** do mês (`Percentual_Dividend_Yield_Mes`, `Percentual_Amortizacao_Cotas_Mes`, rentabilidades).
- Não há valor por cota, data-com nem data de pagamento.
- A defasagem é mensal.

Não serve para registrar proventos nem para descobrir próximos pagamentos. Pode servir no futuro para conferência de DY mensal.

## Próximos pagamentos

1. Somente eventos **oficiais** (brapi ou FundosNET, ou cadastrados manualmente como "anunciado") aparecem como anúncio.
2. Previsões são cadastradas manualmente pelo usuário (natureza "Previsão") e aparecem em coluna separada, rotuladas como estimativa.
3. Sem anúncio oficial com pagamento futuro, a tela mostra **"Aguardando divulgação."**

## Atualizações

| Modo | Como funciona |
| ---- | ------------- |
| Manual | Botões em Carteira, Proventos, Fundo e Integrações |
| Automática | Configurável por usuário (Integrações). Ao abrir uma página privada, se o intervalo venceu (contado a partir da última **tentativa**), roda em segundo plano via `after()` do Next |
| Agendada externa | `GET /api/cron/refresh` com `Authorization: Bearer $CRON_SECRET` (desabilitada sem o segredo). Parâmetros `?quotes=0` / `?dividends=0` |

- Cada execução gera um registro em `sync_runs`, com status (Sucesso, Parcial, Falhou, Ignorado), origem, contagens e detalhes por fundo. A tela de Integrações mostra a última tentativa e o último sucesso.
- **Falhas nunca apagam ou zeram dados.** Cotações só são gravadas quando válidas (preço > 0 e horário informado). A última cotação válida continua valendo.
- **Atual × desatualizada:** a cotação atual é a que se refere ao instante mais recente:
  - horário de mercado, para cotações automáticas;
  - data de referência, para manuais com data;
  - momento do registro, para manuais sem data.

  A cotação é marcada como desatualizada após `QUOTE_STALE_AFTER_BUSINESS_HOURS` horas úteis (seg–sex; feriados não são considerados).

## Rodando neste tipo de ambiente

O diagnóstico real (não grava nada no banco):

```bash
npm run integrations:check -- MXRF11 HGLG11
```

Em ambientes com proxy HTTP obrigatório, o `fetch` do Node só usa o proxy com
`NODE_USE_ENV_PROXY=1` (Node ≥ 22.21). Em uma máquina comum, isso não é necessário.

## Variáveis de ambiente

Ver `.env.example`: `INTEGRATIONS_ENABLED`, `BRAPI_API_KEY`,
`BRAPI_DAILY_CLOSE_FALLBACK`, `FUNDOSNET_ENABLED`,
`QUOTE_STALE_AFTER_BUSINESS_HOURS`, `QUOTE_CACHE_TTL_SECONDS`, `CRON_SECRET`.
