# Status do Projeto — Bola de Neve

> Atualizar este arquivo ao final de cada etapa: o que foi feito, o que falta e
> problemas conhecidos.

## Resumo

| Etapa | Descrição | Status |
| ----- | --------- | ------ |
| 1 | Fundação e arquitetura | ✅ Concluída (2026-11-20) |
| 2+ | Funcionalidades (a definir nos próximos prompts) | ⏳ Não iniciada |

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
