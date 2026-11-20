# Bola de Neve (Snowball)

Plataforma privada de gestão de investimentos em Fundos Imobiliários (FIIs).

- **Carteira real:** operações, preço médio e resultados, com livro-razão auditável.
- **Cotações automáticas:** brapi.
- **Proventos:** brapi e avisos oficiais da B3 FundosNET, com elegibilidade calculada na data-com.
- **Simulador "bola de neve":** dividendos reinvestidos compram novas cotas, que geram novos dividendos.

> **Status:** 5 etapas concluídas — fundação, carteira e operações,
> integrações e proventos, simulador e a experiência final (dashboard, metas,
> calendário, central de dados, segurança). Detalhes em
> [`DOCUMENTATION/PROJECT_STATUS.md`](DOCUMENTATION/PROJECT_STATUS.md).

## Funcionalidades

| Área | Destaques |
| ---- | --------- |
| Visão geral | Patrimônio, investido, lucro/prejuízo, rentabilidade, cotas, dividendos (mês/ano/acumulado/média), renda recorrente, metas, gráficos de evolução, dividendos, aportes e distribuição — tudo do banco |
| Carteira e movimentações | Saldo inicial sem data inventada, compras/vendas com taxas, preço médio ponderado, resultado realizado e não realizado, correção/cancelamento com motivo, nada é apagado |
| Análises | Por fundo e segmento; página individual com cotação, histórico de preços, último/próximo provento e resultado |
| Dividendos | Anunciado × pago × previsto × recebido; importação sem duplicidade; elegibilidade pela data-com; DY e yield on cost; calendário |
| Simulador | Modelos mensal e calendário, vários fundos, reinvestimento 0–100%, aportes, cenários hipotéticos, comparação de estratégias, marcos, cotas compradas só com dividendos |
| Metas | Renda mensal, patrimônio, cotas e personalizadas, com progresso e prazo estimado por simulação |
| Central de dados | Origem dos dados, integrações, histórico de atualizações, exportação CSV/Excel, backup e restauração |
| Segurança | Sessões no banco, scrypt, rate limit, CSP com nonce, triggers de integridade — ver [SECURITY.md](DOCUMENTATION/SECURITY.md) |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 5.9 · Tailwind CSS 4 + shadcn/ui · Recharts 3 · PostgreSQL 16 + Prisma 7 · Zod 4 · decimal.js · Vitest + Playwright.

## Executar localmente

Requisitos: Node.js 20.19+ ou 22.12+ e PostgreSQL 14+.

Instale as dependências:

```bash
npm install
```

Crie o `.env` a partir do modelo e edite `DATABASE_URL` (opcional: `BRAPI_API_KEY`):

```bash
cp .env.example .env
```

Aplique as migrações:

```bash
npm run db:deploy
```

Crie o usuário (a senha é pedida no terminal; mínimo de 12 caracteres, com letras e números):

```bash
npm run user:create -- --email voce@exemplo.com --name "Seu Nome"
```

Opcional — cadastre a carteira inicial (MXRF11 e HGLG11 como saldos iniciais):

```bash
npm run portfolio:seed -- --email voce@exemplo.com
```

Suba o servidor:

```bash
npm run dev
```

Acesse <http://localhost:3000>.

Para os testes de integração e E2E, crie também um `.env.test` apontando para um banco **separado**, cujo nome contenha `test`.

## Publicar

Siga [DOCUMENTATION/DEPLOYMENT.md](DOCUMENTATION/DEPLOYMENT.md):

- variáveis de ambiente;
- PostgreSQL dedicado;
- `npm ci && npm run db:deploy && npm run build`;
- `next start` atrás de proxy reverso com HTTPS;
- backups agendados;
- procedimento de atualização.

Nenhum deploy é feito automaticamente.

## Scripts

| Script | Descrição |
| ------ | --------- |
| `npm run dev` / `build` / `start` | Desenvolvimento, build e servidor de produção |
| `npm run typecheck` / `lint` | TypeScript (com tipos de rotas) e ESLint |
| `npm test` | Unitários (domínio, simulador, provedores com respostas simuladas, exportação) |
| `npm run test:integration` | Integração com PostgreSQL (`.env.test`) |
| `npm run test:e2e` | E2E no build de produção (rode `npm run build` antes) |
| `npm run check` | typecheck + lint + unitários + integração |
| `npm run db:migrate` / `db:deploy` | Migrações (desenvolvimento / produção) |
| `npm run db:check` | Teste de conexão com o banco |
| `npm run db:backup` | Backup completo do banco (pg_dump) em `backups/` |
| `npm run user:create` | Cria usuário ou redefine senha (`--reset-password`) |
| `npm run portfolio:seed` | Cadastra a carteira inicial informada |
| `npm run integrations:check` | Diagnóstico real das APIs externas (não grava nada) |

## Documentação

- [Guia de uso](DOCUMENTATION/USER_GUIDE.md)
- [Arquitetura](DOCUMENTATION/ARCHITECTURE.md)
- [Regras financeiras](DOCUMENTATION/FINANCIAL_RULES.md)
- [Integrações externas](DOCUMENTATION/INTEGRATIONS.md)
- [Segurança](DOCUMENTATION/SECURITY.md)
- [Instalação, publicação e manutenção](DOCUMENTATION/DEPLOYMENT.md)
- [Status do projeto](DOCUMENTATION/PROJECT_STATUS.md)

## Avisos

- Simulações e cenários são **hipotéticos**; dividendos não são garantidos.
- Cotações sem `BRAPI_API_KEY` podem ser o fechamento do dia anterior. A origem e a idade aparecem sempre ao lado do valor.
- O resultado realizado é gerencial — **não** é cálculo de imposto.
