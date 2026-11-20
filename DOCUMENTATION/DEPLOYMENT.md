# Instalação, publicação e manutenção — Bola de Neve

> Nenhum deploy foi feito automaticamente. Publicar exige um servidor, um
> PostgreSQL e credenciais suas. Este guia descreve o caminho recomendado.

## Requisitos

| Item | Versão |
| ---- | ------ |
| Node.js | 20.19+ ou 22.12+ (desenvolvido em 22.23) |
| PostgreSQL | 14+ (desenvolvido em 16) |
| Ferramentas | `pg_dump` / `pg_restore` da mesma versão do servidor (backups) |
| HTTPS | obrigatório em produção (cookie de sessão `Secure`, HSTS) |

## Variáveis de ambiente

Modelo completo em `.env.example`.

| Variável | Obrigatória | Uso |
| -------- | ----------- | --- |
| `DATABASE_URL` | sim | `postgresql://usuario:senha@host:5432/banco?schema=public` |
| `SESSION_TTL_HOURS` | não | duração da sessão (padrão 168 = 7 dias) |
| `SESSION_COOKIE_SECURE` | não | padrão `true` em produção; **não** desative atrás de HTTPS |
| `INTEGRATIONS_ENABLED` | não | `false` desliga todas as consultas externas |
| `BRAPI_API_KEY` | não | chave da brapi (cotação atual de FIIs; endpoints de FII são do plano Pro) |
| `BRAPI_DAILY_CLOSE_FALLBACK` | não | usa o último fechamento quando o plano não libera a cotação atual |
| `FUNDOSNET_ENABLED` | não | avisos oficiais de rendimentos na B3 (exige CNPJ no fundo) |
| `QUOTE_STALE_AFTER_BUSINESS_HOURS` | não | limite para "Desatualizada" (padrão 24) |
| `QUOTE_CACHE_TTL_SECONDS` | não | cache das cotações (padrão 900) |
| `CRON_SECRET` | não | habilita `/api/cron/refresh` (mínimo de 32 caracteres) |

- Segredos (senha do banco, `BRAPI_API_KEY`, `CRON_SECRET`) **nunca** vão para o repositório.
- Em servidor, use variáveis do serviço (systemd `EnvironmentFile` com permissão `600`) ou o gerenciador de segredos da hospedagem.

## Executar localmente

Instale as dependências (o `postinstall` gera o cliente Prisma):

```bash
npm install
```

Crie o `.env` a partir do modelo e edite o `DATABASE_URL`:

```bash
cp .env.example .env
```

Aplique as migrações:

```bash
npm run db:deploy
```

Crie o seu usuário (a senha é pedida no terminal):

```bash
npm run user:create -- --email voce@exemplo.com --name "Seu Nome"
```

Opcional — cadastre a carteira inicial informada:

```bash
npm run portfolio:seed -- --email voce@exemplo.com
```

Suba o servidor de desenvolvimento:

```bash
npm run dev
```

## PostgreSQL

Crie um usuário e um banco **dedicados**, com senha forte; não use o superusuário na aplicação:

```bash
sudo -u postgres psql -c "CREATE ROLE bdn LOGIN PASSWORD 'troque-esta-senha';" -c "CREATE DATABASE bola_de_neve OWNER bdn;"
```

Recomendações:

- Aceitar conexões só de `localhost` ou da rede privada (`listen_addresses` e `pg_hba.conf` com `scram-sha-256`).
- Banco gerenciado: exigir TLS (`?sslmode=require` no `DATABASE_URL`).
- O banco protege a integridade por conta própria:
  - triggers impedem excluir ou alterar operações e proventos;
  - a auditoria é somente-inserção;
  - CHECKs e índices únicos barram valores inválidos e duplicidades.

  **Não** desabilite os triggers.
- Os testes usam um banco separado cujo nome contém `test` (`.env.test`); eles apagam os dados desse banco.

## Publicação recomendada (servidor próprio / VPS)

Compile e aplique as migrações:

```bash
npm ci
```

```bash
npm run db:deploy
```

```bash
npm run build
```

Rode `next start` como serviço (exemplo de systemd em `/etc/systemd/system/bola-de-neve.service`):

```ini
[Unit]
Description=Bola de Neve
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/bola-de-neve
EnvironmentFile=/etc/bola-de-neve.env
ExecStart=/usr/bin/npx next start -p 3000 -H 127.0.0.1
Restart=on-failure
User=bdn

[Install]
WantedBy=multi-user.target
```

Coloque um proxy reverso com HTTPS na frente. Exemplo com Caddy (`/etc/caddy/Caddyfile`):

```
financas.seudominio.com.br {
  reverse_proxy 127.0.0.1:3000
}
```

O proxy deve **sobrescrever** `X-Forwarded-For`; o limite de tentativas de login por IP depende disso.

Plataformas serverless (por exemplo, Vercel) também funcionam:

- use um PostgreSQL gerenciado;
- configure as variáveis de ambiente no painel;
- agende `/api/cron/refresh` (Authorization `Bearer $CRON_SECRET`) para as atualizações automáticas fora do uso.

## Atualizações automáticas

Rodam ao abrir o sistema, conforme o intervalo definido em Configurações. Para horários fixos, use um agendador externo:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://financas.seudominio.com.br/api/cron/refresh
```

## Backups

| Tipo | Como | Conteúdo |
| ---- | ---- | -------- |
| Banco completo | `npm run db:backup` (pg_dump, formato custom) | todas as tabelas, usuários, sessões, auditoria e triggers |
| Dados do usuário | Central de dados → **Baixar backup** (JSON com checksum) | carteira, operações, cotações, proventos, recebimentos, simulações, metas, auditoria; **sem** senhas/sessões |
| Planilhas | Central de dados → CSV/Excel | leitura e análise externas (não é backup restaurável) |

Agende o `db:backup` diariamente e guarde cópias fora do servidor. Os arquivos são criados com permissão `600` e podem conter dados financeiros. Exemplo de cron:

```
30 3 * * * cd /opt/bola-de-neve && npm run db:backup >> /var/log/bdn-backup.log 2>&1
```

Para restaurar o banco completo, use um banco **vazio**:

```bash
pg_restore --no-owner --dbname="postgresql://bdn:SENHA@localhost:5432/bola_de_neve_novo" backups/ARQUIVO.dump
```

A restauração do JSON pela interface só é aceita em uma conta **sem dados**. Ela nunca apaga nem sobrescreve, gera novos IDs e revalida o livro-razão.

Ambos os caminhos foram testados neste projeto: restauração do `pg_dump` em banco novo e ida e volta do JSON entre contas.

## Procedimento de atualização de versão

1. Faça o backup: `npm run db:backup`.
2. Atualize o código (`git pull` da versão desejada).
3. Instale as dependências com `npm ci` (regenera o cliente Prisma).
4. Aplique as migrações com `npm run db:deploy`. As migrações são versionadas e nunca editadas depois de aplicadas.
5. Gere o build com `npm run build`.
6. Reinicie o serviço (`systemctl restart bola-de-neve`).
7. Verifique:
   - `GET /api/health` → `{"status":"ok","database":"up"}`;
   - `npm run db:check`.

Antes de publicar, rode a checagem completa em um ambiente com banco de teste:

```bash
npm run check
```

```bash
npm run build
```

```bash
npm run test:e2e
```

## Ambientes com proxy HTTP obrigatório

O `fetch` do Node só usa `HTTPS_PROXY` com `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21). Não é necessário em servidores comuns.
