# Bola de Neve (Snowball)

Plataforma privada de gerenciamento de investimentos em Fundos Imobiliários
(FIIs): acompanhamento de carteira, monitoramento de proventos e simulador de
reinvestimento de dividendos (efeito "bola de neve").

> **Status:** Etapa 4 concluída — carteira e operações, cotações automáticas,
> proventos e o **simulador Bola de Neve** (reinvestimento mês a mês, vários
> fundos, cenários hipotéticos, marcos, gráficos). Detalhes em
> [`DOCUMENTATION/PROJECT_STATUS.md`](DOCUMENTATION/PROJECT_STATUS.md).

## Stack

| Camada          | Tecnologia                                   |
| --------------- | -------------------------------------------- |
| Framework       | Next.js 16 (App Router) + React 19           |
| Linguagem       | TypeScript 5.9 (strict)                      |
| UI              | Tailwind CSS 4, shadcn/ui (Radix), Lucide    |
| Gráficos        | Recharts 3 (instalado, uso a partir da etapa de dashboard) |
| Banco           | PostgreSQL 16 + Prisma ORM 7 (adapter `pg`)  |
| Validação       | Zod 4                                        |
| Números         | decimal.js (nunca ponto flutuante em dinheiro) |
| Autenticação    | Sessões próprias no banco, senha com scrypt  |
| Testes          | Vitest (unit + integração), Playwright (E2E) |

## Requisitos

- Node.js **20.19+** ou **22.12+** (desenvolvido com 22.23)
- PostgreSQL **14+** (desenvolvido com 16)

## Primeiros passos

```bash
npm install
```

```bash
cp .env.example .env
```

Edite `.env` com a URL do seu PostgreSQL. Para os testes de integração/E2E,
crie também `.env.test` apontando para um banco **separado** cujo nome contenha
`test` (ex.: `snowball_test`) — os testes apagam os dados desse banco.

```bash
npm run db:deploy
```

```bash
npm run db:check
```

Crie o usuário da plataforma (a senha é pedida no terminal, sem eco; mínimo de
12 caracteres com letras e números):

```bash
npm run user:create -- --email voce@exemplo.com --name "Seu Nome"
```

Opcional — cadastrar a carteira inicial (MXRF11 e HGLG11 como saldos
iniciais com cotações manuais de referência; idempotente):

```bash
npm run portfolio:seed -- --email voce@exemplo.com
```

```bash
npm run dev
```

Acesse <http://localhost:3000> e entre com o usuário criado.

## Scripts

| Script                     | Descrição                                               |
| -------------------------- | ------------------------------------------------------- |
| `npm run dev`              | Servidor de desenvolvimento                             |
| `npm run build` / `start`  | Build e servidor de produção                            |
| `npm run typecheck`        | Gera tipos de rotas (`next typegen`) e roda `tsc`       |
| `npm run lint`             | ESLint                                                  |
| `npm test`                 | Testes unitários (sem banco)                            |
| `npm run test:integration` | Testes de integração com PostgreSQL (`.env.test`)       |
| `npm run test:e2e`         | Testes E2E (Playwright) contra o build de produção — rode `npm run build` antes |
| `npm run check`            | typecheck + lint + unit + integração                    |
| `npm run db:migrate`       | Cria/aplica migrações em desenvolvimento                |
| `npm run db:deploy`        | Aplica migrações pendentes (produção/CI)                |
| `npm run db:check`         | Testa a conexão com o PostgreSQL                        |
| `npm run db:studio`        | Prisma Studio                                           |
| `npm run user:create`      | Cria usuário ou redefine senha (`--reset-password`)     |
| `npm run portfolio:seed`   | Cadastra a carteira inicial informada (`--email`)       |
| `npm run integrations:check` | Diagnóstico real das APIs (não grava nada)            |

## Documentação

- [Arquitetura](DOCUMENTATION/ARCHITECTURE.md)
- [Regras financeiras](DOCUMENTATION/FINANCIAL_RULES.md)
- [Integrações externas](DOCUMENTATION/INTEGRATIONS.md)
- [Status do projeto](DOCUMENTATION/PROJECT_STATUS.md)

## Segurança

- Nunca versione `.env`/`.env.test` (já ignorados pelo Git). Use `.env.example`
  como modelo.
- Senhas são armazenadas apenas como hash scrypt; tokens de sessão apenas como
  SHA-256.
- Em produção, sirva a aplicação **somente via HTTPS** (o cookie de sessão é
  `Secure`) atrás de um proxy reverso que sobrescreva `X-Forwarded-For`.
