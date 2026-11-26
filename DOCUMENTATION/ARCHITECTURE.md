# Arquitetura — Bola de Neve

## Visão geral

Aplicação monolítica Next.js (App Router) com renderização no servidor,
PostgreSQL como única fonte de verdade e camadas separadas para que regras de
negócio e cálculos financeiros fiquem **fora da interface**.

```
Navegador ──► proxy.ts (checagem otimista do cookie)
                │
                ▼
          App Router (src/app) ── Server Components / Server Actions / Route Handlers
                │
                ├─► DAL de autenticação (src/server/auth/dal.ts)  ← valida sessão no banco
                ├─► Serviços (src/server/services)               ← casos de uso
                │       ├─► Domínio (src/domain)                  ← regras/cálculos puros
                │       ├─► Integrações (src/server/integrations) ← APIs externas
                │       └─► Banco (src/server/db → Prisma → PostgreSQL)
                └─► Validação (src/validation, Zod)               ← entrada de formulários/APIs
```

## Estrutura de pastas

```
prisma/
  schema.prisma          Modelos e convenções do banco
  migrations/            Migrações SQL versionadas (nunca editar as já aplicadas)
prisma.config.ts         Configuração do Prisma CLI (Prisma 7)
scripts/
  create-user.ts         Cria o usuário / redefine senha (CLI)
  check-db.ts            Teste de conexão com o PostgreSQL
  seed-initial-portfolio.ts  Cadastra a carteira inicial informada (idempotente)
src/
  app/                   Rotas (App Router)
    (auth)/login/        Página e formulário de login (público)
    (app)/               Área privada — layout exige sessão válida; menu lateral
      dashboard/         Visão geral (dados do banco, gráficos, metas)
      analise/           Análise da carteira (pesos, resultados, renda)
      fundos/            Análise individual (índice → /carteira/[ticker])
      metas/             Metas financeiras
      calendario/        Calendário de proventos
      dados/             Central de dados (integrações, origem, exportação, backup)
      configuracoes/     Perfil, senha, sessões, atualização automática
      loading.tsx, error.tsx, not-found.tsx  Estados de carregamento/erro
      dashboard/         Painel com resumo da carteira
      carteira/          Lista de posições, novo FII, posição individual,
                         edição/remoção (arquivamento) e saldo inicial
      operacoes/         Histórico com filtros, nova operação e detalhe
                         (correção, cancelamento, trilha de auditoria)
      renda-fixa/        Lista de títulos, novo título, detalhe (aportes/resgates,
                         evolução mensal) e edição/arquivamento
    api/health/          Health check público (sem dados sensíveis)
    layout.tsx, page.tsx Layout raiz; "/" redireciona para /dashboard
  components/
    ui/                  Componentes shadcn/ui (código copiado, editável)
    layout/              Componentes estruturais (cabeçalho etc.)
    forms/               ActionForm/Field: formulários ligados a Server Actions
    portfolio/           Exibição de valores, tabela de operações, prévia de operação
    fixed-income/        Campos do título (LCI/LCA → isento) e aviso de estimativa
  domain/                Regras de negócio e cálculos PUROS (sem I/O, sem React)
    money.ts             Decimal, escalas, arredondamento, formatação, parse pt-BR
    dates.ts             Datas de calendário (pregão) e fuso de São Paulo
    fixed-income/        Renda fixa: calendário de feriados, IR/IOF, motor de cálculo, rótulos
    portfolio/ledger.ts  Livro-razão: saldo inicial, compra, venda, PM, realizado
    portfolio/metrics.ts Métricas da posição e consolidação da carteira
    portfolio/history.ts Evolução mensal (investido × mercado), aportes, distribuição
    goals.ts             Progresso e estimativa de prazo de metas
    dividends.ts         Elegibilidade na data-com, status, renda, DY, competência
    quotes.ts            Atualidade da cotação (horas úteis)
    simulation/          Motor "Bola de Neve" (puro, determinístico)
      types.ts           Configuração, premissas e resultados
      assumptions.ts     Trajetórias de preço/dividendo; divisão exata por pesos
      engine.ts          Cálculo mês a mês (mensal simplificado e calendário)
      milestones.ts      Marcos e objetivos
      scenarios.ts       Cenários hipotéticos (referência, conservador, moderado, otimista)
      defaults.ts        Configurações padrão e exemplo das 96 cotas
  generated/prisma/      Cliente Prisma gerado (ignorado pelo Git)
  lib/                   Utilitários genéricos de UI (cn)
  server/                Código exclusivo do servidor
    env.ts               Validação das variáveis de ambiente (Zod)
    db/                  Fábrica e instância única do Prisma
    auth/                Autenticação (ver seção abaixo)
    actions/             Server Actions (formulários) — validam, chamam serviços
    services/            Serviços de aplicação (casos de uso)
      portfolio/         fund-service, operation-service, ledger-sync
      market/            cotações, histórico, dados cadastrais, sync-log, auto-refresh
      dividends/         eventos, recebimentos, elegibilidade, importação
      simulation/        salvar/editar (versões)/duplicar/excluir; importar CÓPIA da carteira
      overview/          Visão geral consolidada (reaproveita carteira, proventos e ledger)
      goals/             Metas (valor atual do banco; prazo pela simulação)
    export/              CSV/XLSX (sem dependências pesadas), conjuntos exportáveis, backup/restauração
    integrations/        Provedores externos (ver INTEGRATIONS.md)
      types.ts           PriceProvider, DividendProvider, AssetInformationProvider
      brapi/, b3/        Implementações (brapi; B3 FundosNET)
      http.ts, limiter.ts, cache.ts, errors.ts, registry.ts
      audit.ts, errors.ts
    integrations/        Clientes de APIs externas — próximas etapas
  validation/            Schemas Zod compartilhados (formulários, APIs)
  proxy.ts               Proxy do Next 16 (antigo middleware)
tests/
  unit/                  Vitest, sem banco
  integration/           Vitest + PostgreSQL real (.env.test)
  e2e/                   Playwright contra o build de produção
  support/               Helpers de teste
```

### Regras de dependência entre camadas

| Camada             | Pode importar                                   | Não pode importar          |
| ------------------ | ----------------------------------------------- | -------------------------- |
| `src/domain`       | `decimal.js`, `zod`, outros módulos do domínio  | Prisma, Next, React, `server/*` |
| `src/validation`   | `zod`, `src/domain`                             | Prisma, Next, `server/*`   |
| `src/server/*`     | `domain`, `validation`, Prisma, Next (só em `auth/session.ts`, `dal.ts`, `actions.ts`) | componentes de UI |
| `src/components`   | `lib`, `domain` (formatação), tipos públicos    | Prisma, `server/db`        |
| `src/app`          | tudo acima                                      | —                          |

- **Cálculos financeiros** ficam em `src/domain`, são puros e testados
  unitariamente. A UI apenas exibe resultados.
- **Serviços** recebem o banco por parâmetro (`db: Database`) para facilitar
  testes de integração e reuso em scripts.
- Módulos com `import "server-only"` falham no build se importados por Client
  Components.

## Banco de dados

- PostgreSQL acessado via Prisma 7 com o driver adapter `@prisma/adapter-pg`.
- Cliente gerado em `src/generated/prisma` (`npm install` executa
  `prisma generate` no `postinstall`).
- Instância única e lazy em `src/server/db/client.ts` (`getDb()`): o build não
  exige banco e o hot reload não abre novos pools.

### Convenções

- Modelos `PascalCase` singular → tabelas `snake_case` plural (`@@map`).
- Campos `camelCase` → colunas `snake_case` (`@map`).
- IDs `cuid()` (texto). Datas `timestamptz` em UTC.
- **Dinheiro/quantidades: `Decimal` com precisão explícita, nunca `Float`**
  (escalas em [`FINANCIAL_RULES.md`](FINANCIAL_RULES.md#precisão-e-arredondamento)).
- Toda entidade de domínio terá `userId` com `onDelete: Cascade`, e toda
  consulta de serviço filtra pelo usuário autenticado.
- Mudanças de schema sempre via `npm run db:migrate -- --name <descricao>`;
  migrações aplicadas não são editadas.

### Modelo atual

| Tabela           | Finalidade                                                   |
| ---------------- | ------------------------------------------------------------ |
| `users`          | Usuário da plataforma (e-mail único, nome, hash scrypt)      |
| `sessions`       | Sessões ativas: SHA-256 do token, expiração, IP, user agent  |
| `login_attempts` | Tentativas de login (sucesso/falha) para rate limit/auditoria |
| `funds`          | FIIs do usuário (ticker único por usuário, nome/segmento opcionais, `archived_at`) |
| `operations`     | Movimentações: `INITIAL_BALANCE`, `BUY`, `SELL`; status `ACTIVE`/`CANCELED`/`SUPERSEDED`; campos derivados do ledger |
| `positions`      | Cache da posição por fundo (quantidade, custo total, realizado), regravado na mesma transação |
| `price_quotes`   | Histórico de cotações (`source = MANUAL` nesta etapa), com data de referência opcional |
| `audit_events`   | Trilha de auditoria somente-inserção (fundos, operações, cotações, proventos) |
| `daily_prices`   | Fechamentos diários importados (único por fundo/data/fonte) |
| `dividend_events` | Proventos: natureza (oficial/previsão), tipo (rendimento/amortização), fonte, valor/cota, data-com, pagamento, competência |
| `dividend_receipts` | Recebimentos registrados: quantidade elegível (histórico ou manual), valor total |
| `sync_runs`      | Registro de cada atualização (tipo, provedor, gatilho, status, detalhes) |
| `user_settings`  | Atualização automática (ligada, intervalos) |
| `simulations`    | Simulações salvas: configuração (JSON validado por Zod) e resumo; sem referência à carteira real |
| `simulation_versions` | Histórico de versões de cada simulação (criação, edições, restaurações) |
| `financial_goals` | Metas: tipo (renda, patrimônio, cotas, personalizada), alvo, valor atual manual (personalizada), simulação para estimativa |
| `fixed_income_assets` | Títulos de renda fixa do usuário: tipo (CDB, RDB, LCI, LCA, Tesouro Selic, Outro…), indexador, % do indexador, spread, isenção, liquidez, vencimento, `archived_at` |
| `fixed_income_movements` | Aportes (valor aplicado) e resgates (valor **líquido** recebido) por título |
| `index_daily_rates` | Cache das taxas diárias do CDI/Selic (Banco Central SGS), única por indexador + data |
| `index_sync_status` | Última tentativa/sucesso/erro da atualização de cada indexador |

### Interface (Etapa 5)

- **Tema escuro:**
  - fundo azul-marinho, cards com leve gradiente;
  - roxo profundo no menu e nos realces;
  - laranja como cor de ação;
  - verde/vermelho para resultados (tokens `--positive`/`--negative`);
  - animações sutis, respeitando `prefers-reduced-motion`.
- **Menu lateral** fixo (≥ 1024 px) e gaveta acessível no celular. Fica fora do cabeçalho, porque o `backdrop-filter` criaria um bloco de contenção para elementos `fixed`.
- **Gráficos (Recharts):**
  - séries com a paleta categórica validada (azul, laranja, aqua, amarelo);
  - legenda sempre que há 2 ou mais séries;
  - tooltip com crosshair;
  - pontos sem dado aparecem como "indisponível" (nunca zero);
  - os mesmos valores aparecem em tabela na página.
- `.grid > * { min-width: 0 }` impede que tabelas largas estourem a tela no celular; as tabelas rolam no próprio contêiner.

### Integridade da carteira

- **Fonte de verdade:** operações ativas. `positions` e os campos derivados de
  `operations` (`quantity_after`, `average_price_after`, `cost_of_sold`,
  `realized_result`) são recalculados por `rebuildFundLedger` dentro da mesma
  transação de cada alteração.
- **Concorrência:** cada alteração faz `SELECT … FOR UPDATE` na linha do fundo,
  serializando operações simultâneas no mesmo fundo.
- **Garantias no banco** (migrações `*_operations_integrity` e
  `*_integrity_error_messages`): CHECKs de valores positivos, data obrigatória
  exceto no saldo inicial, motivo obrigatório para operações inativas, índice
  único parcial (um saldo inicial ativo por fundo), trigger que impede
  `DELETE` e alteração dos dados informados de operações, trigger que torna
  `audit_events` somente-inserção, `ON DELETE RESTRICT` de operações para
  fundos.
- Consequência: excluir um usuário com operações exige manutenção manual no
  banco (a exclusão em cascata é bloqueada pelos triggers) — intencional.

## Autenticação

Implementação própria, sem bibliotecas de terceiros, adequada a uso individual.

| Arquivo (`src/server/auth/`) | Responsabilidade |
| ---------------------------- | ---------------- |
| `password.ts`   | Hash/verificação scrypt (`node:crypto`), comparação em tempo constante |
| `tokens.ts`     | Token aleatório de 256 bits; banco guarda só o SHA-256 |
| `rate-limit.ts` | Política anti força bruta, em 15 min: 5 falhas por e-mail+IP, 30 por e-mail (todos os IPs), 20 por IP |
| `client-ip.ts`  | IP do cliente sem confiar em valores inventados pelo cliente (Vercel / proxy reverso; último valor das listas) e chave do limite (IPv6 agrupado por /64) |
| `redirect.ts`   | Sanitiza `?next=` com o parser de URL dos navegadores (proteção contra open redirect) |
| `service.ts`    | Casos de uso independentes do Next: `createUser`, `login`, `validateSessionToken`, `revokeSession`, `changePassword`, `purgeExpiredAuthData` |
| `session.ts`    | Cookie de sessão (`HttpOnly`, `SameSite=Lax`, `Secure` em produção) e metadados da requisição |
| `dal.ts`        | **Data Access Layer**: `getCurrentUser()` / `requireUser()` — único ponto de leitura do usuário atual |
| `actions.ts`    | Server Actions de login/logout |
| `constants.ts`  | Nome do cookie e rotas públicas (sem dependências de servidor) |

Fluxo:

1. `proxy.ts` deixa passar rotas públicas (`/login`, `/api/health`, `/api/cron`); sem cookie,
   redireciona páginas para `/login?next=…` e responde `401` para `/api/*`.
2. A verificação **real** acontece na DAL, que consulta a sessão no banco
   (existência e expiração). O layout `(app)` chama `requireUser()`.
3. **Toda Server Action e Route Handler privado deve chamar
   `requireUser()`/`getCurrentUser()` por conta própria** — layouts não protegem
   actions.
4. Login: valida com Zod → pré-checagem do limite **sem trava** (quem já
   estourou é recusado sem entrar na fila) → **reserva a tentativa** numa
   transação `READ COMMITTED` explícita, com advisory lock por e-mail e por IP
   (espera máxima de 1 s; estourou = "muitas tentativas"), contando inclusive as
   tentativas em andamento e gravando a nova como falha → verifica a senha (mesmo
   custo para e-mail inexistente) → marca a tentativa como sucesso → cria sessão
   → define cookie → após a resposta, limpa dados de autenticação antigos. A
   "senha atual" da troca de senha usa o mesmo limite (`checkPasswordWithLimit`).
5. Logout: apaga a sessão no banco e expira o cookie.
6. Sessão com duração fixa (`SESSION_TTL_HOURS`, padrão 7 dias), sem renovação
   automática. Trocar a senha encerra todas as sessões.
7. Server Actions do Next verificam `Origin` × `Host` (proteção CSRF) e o cookie
   é `SameSite=Lax`.

Não há página de cadastro: o usuário é criado por CLI (`npm run user:create`).

### Observações de implantação

- IP do cliente (`client-ip.ts`): na Vercel, `x-vercel-forwarded-for`/`x-real-ip`
  (definidos pela plataforma); fora dela, `x-real-ip` ou o ÚLTIMO valor de
  `X-Forwarded-For` (o do proxy reverso). Sem proxy na frente, nenhum cabeçalho
  é confiável — os limites por e-mail continuam valendo.
- Servir apenas via HTTPS (cabeçalho HSTS já configurado).

## Decisões técnicas

| Decisão | Motivo |
| ------- | ------ |
| Sessões no banco em vez de JWT | Revogação imediata (logout, troca de senha), nada sensível no cliente |
| scrypt nativo em vez de bcrypt/argon2 | Sem dependência nativa; parâmetros N=2^15, r=8, p=1 |
| Auth própria em vez de Auth.js | Usuário único com e-mail/senha; menos superfície e dependências |
| `cacheComponents: false` | Toda a área privada é dinâmica por usuário; reavaliar se surgir conteúdo cacheável |
| `decimal.js` | Precisão decimal exata para cálculos financeiros |
| TypeScript 5.9 (não 7.x) | Compatibilidade garantida com `typescript-eslint` e tooling do Next |
| `"type": "module"` | Configs (Vitest, Playwright) e scripts em ESM nativo |
| Override de `effect` (3.22.5) | Corrige vulnerabilidade (GHSA-7589-6fvf-x4pw) na dependência do Prisma CLI |
| Componentes shadcn/ui adicionados manualmente | O registro `ui.shadcn.com` estava inacessível no ambiente de desenvolvimento; os arquivos seguem o estilo `new-york` e `components.json` permite `npx shadcn add` normalmente |

## Cabeçalhos de segurança

Configurados em `next.config.ts` para todas as rotas: `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
`Strict-Transport-Security`; `X-Powered-By` desativado.

Content-Security-Policy com nonce por requisição, aplicada pelo `proxy.ts` a
todas as páginas e rotas (o matcher só exclui `/_next/static`, `/_next/image`,
`favicon.ico` e `robots.txt`). URLs com codificação `%` malformada recebem 400.
Detalhes em `SECURITY.md`.

## Testes

| Tipo | Ferramenta | Comando | Escopo |
| ---- | ---------- | ------- | ------ |
| Unitário | Vitest | `npm test` | domínio (ledger, métricas, dinheiro, datas), validação, senha, tokens, rate limit, redirect, env |
| Integração | Vitest + PostgreSQL | `npm run test:integration` | conexão, migrações, autenticação, serviços da carteira, transações, triggers, concorrência, persistência |
| E2E | Playwright (Chromium) | `npm run test:e2e` | autenticação; fluxo da carteira pela interface; reinício real do servidor |

Os testes de integração/E2E usam `.env.test` e recusam bancos cujo nome não
contenha `test`, para nunca apagar dados reais.
