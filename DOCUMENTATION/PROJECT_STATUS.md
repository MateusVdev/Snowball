# Status do Projeto — Bola de Neve

> Atualizar este arquivo ao final de cada etapa: o que foi feito, o que falta e
> problemas conhecidos.

## Resumo

| Etapa | Descrição | Status |
| ----- | --------- | ------ |
| 1 | Fundação e arquitetura | ✅ Concluída (2026-11-20) |
| 2 | Carteira, FIIs e operações financeiras | ✅ Concluída (2026-11-20) — aguardando validação do usuário |
| 3+ | A definir nos próximos prompts | ⏳ Não iniciada |

---

## Etapa 2 — Carteira, FIIs e operações financeiras

### Entregue

- **Fundos:** cadastrar (ticker validado, nome/segmento/observações
  opcionais), editar informações (com auditoria), pesquisar por ticker,
  remover = **arquivar** (exige posição zerada; histórico preservado;
  restaurável), posição individual com todas as métricas.
- **Carteira inicial informada:** `npm run portfolio:seed -- --email …`
  cadastra MXRF11 (31 cotas, PM R$ 8,44, cotação manual R$ 8,52) e HGLG11
  (1 cota, PM R$ 145,00, cotação manual R$ 141,80) como **saldos iniciais sem
  data**, sem compras inventadas, com cotações marcadas como **manuais de
  referência**. Nome e segmento ficam "não informados" (não foram fornecidos).
  A mesma carteira também pode ser cadastrada pela tela "Adicionar FII".
- **Operações:** compra e venda com quantidade, preço unitário, taxas, data
  do pregão, valor bruto e valor total/líquido; saldo inicial; prévia do
  valor total no formulário.
- **Cálculos** (`src/domain/portfolio`): quantidade, preço médio ponderado com
  taxas, capital investido, valor atual, resultado realizado (por venda e
  acumulado), resultado não realizado, rentabilidade, resultado total e
  consolidação da carteira — tudo em Decimal (ver `FINANCIAL_RULES.md`).
- **Histórico e integridade:** histórico com filtros (fundo, período, tipo,
  situação); correção rastreável (nova versão + original "Corrigida" com
  motivo); cancelamento com motivo; trilha de auditoria; nada é apagado;
  operações e auditoria protegidas por triggers no PostgreSQL; transações
  atômicas com lock por fundo; reprocessamento completo valida o histórico
  (inclusive vendas retroativas).
- **Cotações manuais:** histórico de cotações por fundo, com data de
  referência opcional e identificação "Manual" na interface.
- **Interface:** Painel (resumo), Carteira, Adicionar FII, Posição individual,
  Editar/remover, Saldo inicial, Registrar operação, Histórico, Detalhe da
  operação (corrigir/cancelar/auditoria).

### Mudanças no banco (3 migrações)

| Migração | Conteúdo |
| -------- | -------- |
| `20261120011255_portfolio_operations` | Tabelas `funds`, `operations`, `positions`, `price_quotes`, `audit_events`; enums `operation_type`, `operation_status`, `quote_source` |
| `20261120011319_operations_integrity` | CHECKs, índice único parcial do saldo inicial, triggers de imutabilidade/não exclusão de operações e de auditoria somente-inserção |
| `20261120011925_integrity_error_messages` | Recria as funções dos triggers com o código de erro padrão, para preservar as mensagens explicativas |

### Testes executados (2026-11-20)

| Verificação | Comando | Resultado |
| ----------- | ------- | --------- |
| TypeScript | `npm run typecheck` | ✅ sem erros |
| ESLint | `npm run lint` | ✅ sem erros/avisos |
| Unitários | `npm test` | ✅ 75/75 (41 novos: ledger, métricas, entrada pt-BR/validação) |
| Integração (PostgreSQL) | `npm run test:integration` | ✅ 28/28 (18 novos: serviços da carteira) |
| Build de produção | `npm run build` | ✅ |
| E2E | `npm run test:e2e` | ✅ 15/15 (9 novos: fluxo da carteira e reinício do servidor) |
| Conexão com o banco | `npm run db:check` | ✅ 4 migrações aplicadas |
| Seed da carteira | `npm run portfolio:seed` (2×) | ✅ cria na 1ª execução, mantém na 2ª |
| `npm audit` | | ✅ 0 vulnerabilidades |

Cobertura dos testes obrigatórios: (1) cadastro de fundos, (2) compra,
(3) venda, (4) PM após compras, (5) PM após vendas, (6) taxas, (7) realizado,
(8) não realizado, (9) atualização da quantidade — unitários, integração e
E2E com valores conferidos manualmente; (10) persistência — integração (nova
conexão) e E2E (encerra o processo `next start` e sobe outro; dados e sessão
continuam).

### Problemas encontrados e soluções

| Problema | Solução |
| -------- | ------- |
| Erro `restrict_violation` dos triggers aparecia no Prisma como "Foreign key constraint violated" | Nova migração recria as funções com o código padrão (`P0001`); a migração original não foi editada |
| `prisma migrate reset` exige consentimento explícito do usuário | Não foi usado; a correção foi feita por migração incremental |
| React 19 reseta formulários após o envio | `ActionForm` devolve os valores digitados e remonta os campos em caso de erro |
| `next start` não encerra com SIGTERM com conexões keep-alive abertas (teste de reinício) | Teste encerra com SIGTERM e, se necessário, SIGKILL (simula também uma queda) |
| Aviso do Vite sobre import sem extensão na config de integração | Import com extensão `.ts` (`allowImportingTsExtensions`) |

### Pendências e limitações conhecidas

- Cotações apenas manuais (integração externa é etapa futura).
- Quantidade de cotas aceita apenas inteiros; eventos corporativos
  (desdobramento/grupamento/amortização) não suportados.
- Resultado realizado é gerencial — **não** é cálculo de imposto.
- Excluir um usuário com operações é bloqueado pelos triggers (intencional).
- Sem paginação no histórico (adequado ao volume de uso individual).
- O ticker não pode ser alterado após o cadastro.
- No ambiente de desenvolvimento deste projeto existe um usuário
  `verificacao@local.dev` com a carteira inicial, criado para a verificação
  manual; não afeta outros ambientes.
- Pendências da Etapa 1 continuam: CSP, agendamento da limpeza de sessões,
  troca de senha pela interface, CI.

### Próxima etapa (não iniciada)

Aguardando validação desta etapa. Base pronta para proventos (quantidade na
data com via ledger), cotações automáticas (`price_quotes.source` aceita
novas origens) e dashboard com gráficos.

---

## Etapa 1 — Fundação e arquitetura

### Análise do ambiente (antes de começar)

- Repositório continha apenas `README.md` (descrição do projeto) e um commit
  inicial. Nenhuma implementação anterior — nada a preservar além do README,
  cuja descrição foi mantida e expandida.
- Node.js 22.23.5, npm 10.9.9, PostgreSQL 16.15 local.

### Entregue

- Projeto Next.js 16.4 (App Router, Turbopack) + React 19.3 + TypeScript 5.9
  strict + Tailwind CSS 4.
- shadcn/ui configurado (`components.json`, tema neutro com variáveis CSS,
  modo escuro preparado) com componentes `button`, `input`, `label`, `card`,
  `alert`. Lucide React e Recharts instalados.
- Arquitetura em camadas: `app`, `components`, `domain`, `server/{auth,db,services,integrations}`,
  `validation`, `tests` (ver `ARCHITECTURE.md`).
- PostgreSQL + Prisma 7.10 (driver adapter `pg`), migração inicial
  `20261120005435_init` com `users`, `sessions`, `login_attempts`.
- Validação de variáveis de ambiente com Zod (`src/server/env.ts`).
- Autenticação completa para usuário único:
  - Login/logout via Server Actions; senha com scrypt; token de sessão
    aleatório (256 bits) armazenado como SHA-256.
  - Cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção, expiração de 7
    dias (configurável).
  - Proteção de rotas em duas camadas: proxy (otimista) + DAL (validação no
    banco).
  - Rate limit de login (5 falhas por e-mail / 20 por IP em 15 min), resposta
    genérica para credenciais inválidas, tempo uniforme para e-mail
    inexistente, proteção contra open redirect no `?next=`.
  - CLI para criar usuário e redefinir senha (encerra todas as sessões).
- Health check público `/api/health` (sem dados sensíveis).
- Cabeçalhos de segurança HTTP; `X-Powered-By` removido.
- Primitivas financeiras em `src/domain/money.ts` (Decimal, escalas,
  arredondamento half-up, formatação BRL).
- Documentação: `README.md`, `.env.example`, `ARCHITECTURE.md`,
  `FINANCIAL_RULES.md`, este arquivo.

### Testes executados (2026-11-20)

| Verificação | Comando | Resultado |
| ----------- | ------- | --------- |
| Instalação limpa | `npm ci` | ✅ 0 vulnerabilidades |
| TypeScript | `npm run typecheck` | ✅ sem erros |
| ESLint | `npm run lint` | ✅ sem erros/avisos |
| Unitários | `npm test` | ✅ 34/34 |
| Integração (PostgreSQL) | `npm run test:integration` | ✅ 10/10 |
| Conexão com o banco | `npm run db:check` | ✅ conectado, 1 migração aplicada |
| Build de produção | `npm run build` | ✅ (também sem `DATABASE_URL`) |
| E2E autenticação | `npm run test:e2e` | ✅ 6/6 |
| CLI de usuário | `npm run user:create` | ✅ criação, senha fraca rejeitada, duplicado rejeitado, reset de senha |

### Problemas encontrados e soluções

| Problema | Solução |
| -------- | ------- |
| `npm audit`: vulnerabilidade alta em `effect@3.20.0` (dependência do Prisma CLI) | `overrides.effect = 3.22.5` no `package.json` (mesma major, corrigida) |
| Registro `ui.shadcn.com` bloqueado pela rede do ambiente | Componentes shadcn/ui escritos manualmente no estilo `new-york`; `components.json` permite usar `npx shadcn add` normalmente em outro ambiente |
| `prisma generate` (postinstall) falhava sem `DATABASE_URL` | `prisma.config.ts` usa `process.env.DATABASE_URL ?? ""` |
| Configs do Vitest geravam aviso CJS/ESM | `"type": "module"` no `package.json` |
| `LayoutProps` não encontrado no `tsc` | `typecheck` executa `next typegen` antes do `tsc` |

### Pendências e limitações conhecidas

- **Content-Security-Policy** ainda não configurada (exige nonce para scripts
  do Next) — planejar antes de produção.
- Rate limit por IP depende de proxy reverso confiável para `X-Forwarded-For`.
- Limpeza de sessões expiradas/tentativas antigas (`purgeExpiredAuthData`)
  existe, mas não está agendada.
- Sem troca de senha pela interface (apenas via CLI).
- Sem CI configurado (GitHub Actions) — os comandos estão prontos em
  `npm run check` + `npm run build` + `npm run test:e2e`.
- Tema escuro definido no CSS, mas sem seletor na interface.
- Arquivos `.env` e `.env.test` locais **não** são versionados; cada ambiente
  precisa criar os seus.

### Não implementado (fora do escopo da Etapa 1)

APIs financeiras, cadastro de FIIs, operações, proventos, simulador e
dashboard financeiro.

### Preparado para a próxima etapa

- Convenções de schema (Decimal com escalas definidas, `userId` com cascade,
  `snake_case`) para adicionar os modelos de FIIs/operações/proventos.
- `src/server/services` e `src/server/integrations` com convenções
  documentadas.
- `src/domain/money.ts` como base dos cálculos; regras de preço médio, posição,
  proventos e indicadores já definidas em `FINANCIAL_RULES.md`.
- `requireUser()` pronto para proteger novas páginas, Server Actions e Route
  Handlers.
- Infraestrutura de testes (unit, integração com banco, E2E) pronta para
  receber novos casos.
