# Segurança — Bola de Neve

Plataforma de uso individual. Revisões:

- Etapa 5 (2026-11-20): revisão inicial;
- **Auditoria completa (2026-11-26)**: OWASP Top 10 / ASVS. Ver a seção
  [Auditoria de 2026-11-26](#auditoria-de-segurança-2026-11-26);
- **Segunda revisão independente (2026-11-26)**: revisão crítica das próprias
  correções. Ver a seção
  [Segunda revisão](#segunda-revisão-independente-2026-11-26).

## Autenticação e sessões

- Senhas com **scrypt** (N=2¹⁵, r=8, p=1, salt de 16 bytes) e comparação em tempo constante.
- Política de senha: mínimo de 12 caracteres, com letras e números.
- Tokens de sessão aleatórios de 256 bits. O banco guarda apenas o **SHA-256** do token.
- Cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção e expiração configurável.
- **Limite de tentativas** (janela de 15 minutos):
  - 5 falhas por **e-mail + IP**;
  - 30 falhas por e-mail somando todos os IPs (força bruta distribuída);
  - 20 falhas por IP somando todos os e-mails.
- "IP", para o limite, é o IPv4 ou o **bloco /64** do IPv6. IPv4 mapeado em IPv6 conta como o próprio IPv4 (`rateLimitIpKey`).
- Como o limite é aplicado:
  1. **pré-checagem sem trava**: quem já estourou é recusado sem entrar em fila;
  2. em seguida, de forma **atômica**: transação `READ COMMITTED` explícita com advisory locks do PostgreSQL por e-mail e por IP;
  3. espera máxima de 1 s pela trava (`lock_timeout`); se estourar, a resposta é "muitas tentativas" (falha fechada);
  4. a tentativa é gravada antes da conferência da senha, então tentativas simultâneas também contam.
- A resposta de login é sempre genérica, e o tempo é o mesmo para e-mail inexistente.
- A "senha atual" na troca de senha usa **o mesmo limite**.
- Troca de senha exige a senha atual e **encerra todas as sessões**. Em Configurações é possível encerrar as outras sessões e ver as ativas.
- Retenção: sessões vencidas e tentativas de login com mais de 90 dias são apagadas após cada login bem-sucedido. A rotina agendada (`/api/cron/refresh`) também apaga, mas só quando `CRON_SECRET` está configurado; hoje, em produção, ela está desligada.
- Proteção de rotas em duas camadas:
  - `proxy` faz a checagem rápida do cookie;
  - a **DAL** (`requireUser`/`getCurrentUser`) valida a sessão no banco em toda página, Server Action e rota de API privada.
- Destino pós-login (`?next=`): interpretado com o parser de URL dos navegadores (WHATWG). Só caminhos do próprio site são aceitos; caracteres de controle e `\` são recusados (`redirect.ts`).

## Autorização e exposição de dados

- Toda consulta e alteração de dados de carteira, proventos, simulações, metas, renda fixa e exportações filtra pelo `userId` da sessão. Isso é verificado por varredura e por testes de isolamento entre usuários, inclusive uma matriz de escrita (`tests/integration/security.test.ts`).
- Server Actions: todas (exceto login/logout) chamam `requireUser()` como primeira instrução.
- Um teste-guarda (`tests/unit/security.test.ts`) falha se surgir:
  - action sem essa chamada no início;
  - action exportada de outra forma (arrow function, `export const`, `export {…}`);
  - `"use server"` / `'use server'` fora dos módulos de actions;
  - uso, no app, da conferência de senha sem limite (`verifyUserPassword`).
- O Next verifica `Origin` × `Host` (CSRF; testado de ponta a ponta).
- Rotas de API:

| Rota | Proteção |
| ---- | -------- |
| `/api/health` | pública; expõe só `ok`/`degraded`, sem versões nem erros; no máximo 1 consulta ao banco a cada 10 s por instância |
| `/api/export/*`, `/api/backup` | exigem sessão; usam `Cache-Control: no-store` |
| `/api/cron/refresh` | `CRON_SECRET` comparado em tempo constante (via SHA-256, sem revelar o tamanho); desabilitada (404) sem o segredo |

- O backup JSON **não** contém senhas, hashes, sessões nem tentativas de login.
- A exportação CSV neutraliza fórmulas (`'` antes de `= + - @`). O Excel grava textos como texto, nunca como fórmula.

## Validação no servidor

- Todo dado de formulário é validado com **Zod** no servidor, mesmo quando o cliente já validou (o editor do simulador usa o mesmo schema).
- Respostas de APIs externas também são validadas com Zod. Valores numéricos viram Decimal; ausência de dado vira `null`, nunca zero.
- As integrações só consultam hosts fixos (brapi, B3, Banco Central), com parâmetros validados e codificados (sem SSRF).
- Restauração de backup:
  - formato e versão conferidos;
  - checksum SHA-256;
  - limite de 7 MB;
  - aceita apenas conta sem dados;
  - tudo em uma única transação;
  - títulos e movimentos de renda fixa passam pelos **mesmos schemas do cadastro**.

## Integridade do banco

- Triggers impedem `DELETE` e alteração dos dados informados de operações, proventos e recebimentos; a auditoria é somente-inserção.
- CHECKs: valores positivos, datas coerentes, motivo obrigatório ao anular, formato de CNPJ e competência.
- Índices únicos parciais impedem:
  - dois saldos iniciais ativos;
  - proventos duplicados;
  - dois recebimentos ativos para o mesmo provento;
  - leituras de cotação repetidas.
- Alterações rodam em transação, com lock da linha do fundo/título; o livro-razão é reprocessado e validado a cada mudança.
- Consultas SQL "cruas" usam apenas templates parametrizados do Prisma (sem SQL Injection).

## Cabeçalhos HTTP

- **Content-Security-Policy** com nonce por requisição (`proxy.ts`), em **todas** as páginas e rotas. O matcher só exclui `/_next/static`, `/_next/image`, `favicon.ico` e `robots.txt`.
  - scripts só com nonce + `'strict-dynamic'`;
  - `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src 'self'`;
  - `style-src` permite `'unsafe-inline'`, porque gráficos e componentes usam atributos `style`.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`; `X-Powered-By` removido.
- URL com codificação `%` malformada: 400 (o Next responderia 500 em rotas dinâmicas).
- Cabeçalhos conferidos em produção em 2026-11-26, antes desta branch ir ao ar. O comportamento atual (inclusive CSP em todas as páginas e o 400) está coberto por E2E (`tests/e2e/11-security.spec.ts`).

## Credenciais

- `.env`, `.env.test` e `/backups/` são ignorados pelo Git; só o `.env.example` (sem valores) é versionado. O histórico do Git foi varrido em busca de segredos, sem ocorrências.
- A chave da brapi é lida apenas no servidor (`server-only`) e enviada em header, nunca na URL.

---

## Auditoria de segurança (2026-11-26)

### Escopo e método

- **Inventário completo:**
  - 43 Server Actions;
  - 4 rotas de API;
  - todas as páginas e o proxy;
  - autenticação;
  - serviços (isolamento por usuário);
  - backup/restauração e exportação;
  - integrações;
  - configurações, variáveis de ambiente e scripts;
  - histórico do Git;
  - dependências (`npm audit`).
- **Provas de conceito** contra o build de produção **local**, com o banco de teste.
- **Produção:** só sondas de leitura (GET, sem login, sem alterar nada): cabeçalhos, arquivos sensíveis, APIs sem sessão e o campo `next` do login.

### Achados

| # | Vulnerabilidade | Gravidade | Status | Correção |
|---|---|---|---|---|
| 1 | Limite de tentativas de login contornável por requisições **simultâneas**: 30 senhas testadas com limite de 5 (condição de corrida, CWE-362) | **Alta** | Corrigida | Reserva atômica da tentativa: advisory locks por e-mail/IP, contagem das tentativas em andamento e registro antes da conferência da senha (`service.ts`). Reforçada na segunda revisão (R1 e R2) |
| 2 | **Open redirect** no `?next=` do login: `/%09/site` passava pela checagem e o navegador ia para `//site`. Afetava também quem já estava logado (redirecionamento imediato). Confirmado em produção (campo `next` = `/<TAB>/evil.example`) | **Média** | Corrigida | `safeRedirectPath` com o parser de URL WHATWG: recusa controle/`\` e exige a mesma origem após normalizar (`redirect.ts`) |
| 3 | "Senha atual" da troca de senha **sem limite de tentativas** (descoberta da senha com uma sessão roubada) | **Média** | Corrigida | `checkPasswordWithLimit`: mesmo limite do login, contador compartilhado (`settings.ts`, `service.ts`) |
| 4 | Bloqueio da conta do dono por terceiros: 5 falhas por e-mail de qualquer IP bloqueavam todos | Baixa | **Mitigada** | Limite por e-mail+IP (5), teto global por e-mail (30) e por IP (20) (`rate-limit.ts`), com IPv6 agrupado por /64 (R3). Quem controla muitos IPs ou blocos /64 ainda consegue atingir o teto global e bloquear o login por 15 min (troca consciente: o teto protege contra força bruta distribuída) |
| 5 | IP do rate limit lido do **primeiro** valor de `X-Forwarded-For` (inventável pelo cliente atrás de proxy que só acrescenta). Na Vercel **não** era explorável, porque a Vercel sobrescreve o cabeçalho | Baixa | Corrigida | `client-ip.ts`: cabeçalhos da Vercel / proxy, sempre o último valor de listas; só IPs válidos |
| 6 | `/api/health` pública fazia **uma consulta ao banco por requisição** (carga/custo provocáveis sem login) | Baixa | Corrigida | Cache de 10 s com consulta compartilhada (`health-cache.ts`) |
| 7 | "Atualizar índices" com `force` sem intervalo mínimo: cliques repetidos martelavam a API do Banco Central (risco de bloqueio do servidor) | Baixa | Corrigida | Intervalo mínimo de 2 min mesmo forçando (`index-rate-service.ts`) |
| 8 | Restauração aceitava renda fixa que o app não processa (ex.: indexador IPCA), derrubando as telas da própria conta | Baixa | Corrigida | Validação pelos mesmos schemas do cadastro (`backup.ts`) |
| 9 | Dados de autenticação sem retenção: tentativas de login (e-mail/IP) e sessões vencidas nunca eram apagadas (privacidade/LGPD) | Baixa | Corrigida | Limpeza após login e no cron (`actions.ts`, `cron/refresh`) |
| 10 | Comparação do `CRON_SECRET` revelava o tamanho do segredo | Informativa | Corrigida | `secretsEqual` (SHA-256 + tempo constante) |
| 11 | Banco de produção acessado pelo app com o **dono do banco** (`neondb_owner`): permissões além do necessário | Média | Pendente (configuração externa) | Papel de menor privilégio — ver abaixo |
| 12 | Teste de integração dependente da data (falhava em dias úteis) | — (qualidade) | Corrigido | Teste determinístico |

Verificados **sem problemas**:
- todas as Server Actions exigem sessão;
- isolamento entre usuários (IDOR/BOLA) em todos os serviços;
- mass assignment: Zod com campos explícitos;
- CSRF: o Next recusou origem estranha (testado);
- SQL Injection;
- XSS: não há `dangerouslySetInnerHTML`, `eval` nem `localStorage`; os links dinâmicos vêm de constantes;
- SSRF: hosts fixos;
- path traversal: o conjunto de exportação é validado contra lista fixa;
- command injection: não há `exec` com entrada do usuário;
- upload: só o JSON do backup, com limite de 7 MB e validação;
- cabeçalhos HTTP em produção;
- arquivos sensíveis não expostos (`/.env` e `/.git` exigem login → 307);
- segredos no Git;
- `npm audit`: 0 vulnerabilidades;
- `next` na versão mais recente;
- sem registro público nem recuperação de senha (usuário criado por CLI): sem esses vetores.

### Testes que comprovam as correções

- `tests/unit/redirect.test.ts`: TAB/CR/LF/NUL/DEL, `\`, `/a/..//x`, laço no login; confere contra o parser de URL.
- `tests/unit/security.test.ts`:
  - guardas estáticos (actions exigem sessão; rotas de API; rotas públicas);
  - IP do cliente;
  - política de tentativas;
  - segredo;
  - cache do health.
- `tests/integration/security.test.ts`:
  - 30 logins simultâneos → **no máximo 5** senhas testadas (na prática, 5);
  - IP atacante × dono;
  - teto distribuído;
  - troca de senha limitada (também em paralelo);
  - retenção;
  - matriz IDOR com 12 tentativas de escrita entre usuários;
  - backup adulterado recusado sem gravar nada;
  - atualização forçada com intervalo mínimo.
- `tests/e2e/11-security.spec.ts` (Chromium, build de produção):
  - `next` malicioso no login e já logado (fica no site, nenhuma requisição externa);
  - cabeçalhos;
  - APIs sem sessão (401) e cookie inventado;
  - **CSRF**: a mesma chamada real da action, reenviada com `Origin` de outro site, é recusada; o controle (mesma origem) funciona.

### Configurações externas recomendadas

1. **Neon — papel de menor privilégio para o app (achado 11).**
   - No console do Neon (Roles), crie o papel `snowball_app` e execute, como `neondb_owner`:
     ```sql
     GRANT CONNECT ON DATABASE neondb TO snowball_app;
     GRANT USAGE ON SCHEMA public TO snowball_app;
     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO snowball_app;
     GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snowball_app;
     ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO snowball_app;
     ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO snowball_app;
     -- O app não deve mexer no histórico de migrações:
     REVOKE ALL ON TABLE _prisma_migrations FROM snowball_app;
     -- Opcional (a auditoria é somente-inserção):
     REVOKE UPDATE, DELETE ON audit_events FROM snowball_app;
     ```
   - Na Vercel, `DATABASE_URL` (URL **pooled**) passa a usar `snowball_app`.
   - As migrações continuam com `neondb_owner` pela URL **direta**, só no seu computador.
   - Ganho: uma falha no app não consegue apagar tabelas, mudar o schema nem criar papéis.
2. **Vercel:**
   - Deployment Protection (Vercel Authentication) nos deploys de Preview.
   - Previews **nunca** apontando para o banco de produção.
   - Variáveis marcadas como *Sensitive*.
   - Opcional, se o plano permitir: regra de rate limit no Firewall para `POST /login`.
3. **Contas:** 2FA em GitHub, Vercel e Neon.
4. **GitHub:**
   - proteção da branch `main` (exigir PR);
   - Dependabot alerts e secret scanning.
5. **Credencial exposta em conversa anterior:** confirme que a branch de teste do Neon cuja URL foi colada no chat foi excluída, ou redefina a senha.
6. **Neon:** retenção de histórico (point-in-time restore) adequada ao plano.

### Riscos que permanecem (aceitos ou dependentes de decisão)

- Sessão de duração fixa (7 dias, `SESSION_TTL_HOURS`), sem expiração por inatividade.
- Sem 2FA no app e sem checagem de senhas vazadas (exigiria serviço externo).
- Força bruta distribuída: até 30 tentativas por e-mail a cada 15 minutos, troca consciente para evitar o bloqueio do dono por terceiros. Com senha de 12+ caracteres, o risco é baixo.
- Bloqueio do login por terceiros: quem controla vários IPs ou blocos IPv6 /64 consegue atingir o teto global por e-mail e bloquear o login por 15 minutos, renováveis. Para mitigar mais, a solução seria uma regra de Firewall/rate limit na Vercel para `POST /login`.
- Uma enxurrada de tentativas contra o MESMO e-mail ainda pode ocupar conexões do banco por até 1 s, antes de o limite ser atingido; depois disso a pré-checagem recusa sem trava. A proteção de plataforma da Vercel (já observada em teste de carga) ajuda.
- `style-src 'unsafe-inline'` (scripts continuam restritos por nonce).
- Limite de corpo de Server Action de 8 MB (necessário para o upload de backup).
- Fora da Vercel e sem proxy reverso, nenhum cabeçalho de IP é confiável. Os limites por e-mail continuam valendo.
- `scripts/backup-db.sh` passa a URL (com senha) ao `pg_dump` como argumento, visível na lista de processos da própria máquina. Prefira `~/.pgpass` em máquinas compartilhadas.
- Excluir um usuário com operações exige manutenção manual (os triggers bloqueiam a cascata — intencional).

---

## Segunda revisão independente (2026-11-26)

Revisão crítica das próprias correções da auditoria. Cada hipótese foi
**testada antes de corrigir**, no build/banco de teste local (nada em produção).

### Problemas encontrados

| # | Problema | Gravidade | Status | Correção |
|---|---|---|---|---|
| R1 | A correção da corrida (item 1) dependia do isolamento padrão do banco. Com `REPEATABLE READ`, a contagem usava uma "foto" anterior à espera pela trava e **14 de 30** senhas foram testadas | Baixa (latente: o Neon usa `READ COMMITTED`) | Corrigida | Isolamento `READ COMMITTED` explícito na transação |
| R2 | A espera pela trava não tinha limite de tempo. Uma fila de tentativas contra o mesmo e-mail prendia as conexões do pool e uma consulta qualquer do app esperou **7 s** (negação de serviço introduzida pela correção) | **Média** | Corrigida | Pré-checagem sem trava (quem já estourou não entra na fila), `lock_timeout` de 1 s (estourou = "muitas tentativas") e contagem numa só consulta. Depois: **0,8 s** |
| R3 | Limite "por IP" contornável com IPv6: trocando de endereço dentro de um único /64, **30** senhas testadas (meta: 5); também reabria o bloqueio do dono por um único atacante (item 4) | Baixa | Corrigida | Chave do limite por bloco /64 (e IPv4 mapeado = IPv4) |
| R4 | Teste-guarda das Server Actions com **falso positivo**: uma action sem login escrita como arrow function com `'use server'` passava | Teste | Corrigida | Guarda reescrito; comprovado que reprova arrow function, `requireUser` só num `if` e `"use server"` dentro de página |
| R5 | Regressão: o "Atualizar índices" repetido em < 2 min não buscava nada mas dizia "atualizados"; taxas antigas que faltavam (aporte com data antiga) podiam esperar até 1 h | Baixa (funcional) | Corrigida | Taxas antigas que faltam: 1 tentativa a cada 2 min. Mensagem honesta quando nada é buscado |
| R6 | Não detectado na 1ª auditoria: o proxy pulava qualquer URL terminada em `.png`/`.svg`/…, então uma **página** do app nesse endereço era servida **sem CSP** | Baixa | Corrigida | Matcher só exclui assets do Next e o favicon (`public/` está vazia) |
| R7 | Não detectado na 1ª auditoria: `%` malformado em rota dinâmica gerava **500** (no próprio Next), sem CSP | Informativa | Corrigida | Proxy responde 400 |
| R8 | Lacunas de teste: rota de cron e limpeza após o login sem teste | Teste | Corrigida | `tests/integration/cron-route.test.ts` e E2E da retenção |
| R9 | Documentação: item 4 dado como "corrigido" (na verdade, mitigado), cron descrito como ativo, guarda descrito como completo, arquitetura dizendo que a CSP era "melhoria futura", SQL do Neon sem `_prisma_migrations` | Documentação | Corrigida | Este documento e `ARCHITECTURE.md` |

Verificados e mantidos:
- redirecionamento (`safeRedirectPath`): TAB/CR/LF, `\`, `/a/..//x`, Unicode e `%2F` codificado;
- ausência de deadlock na ordem das travas (sempre e-mail → IP);
- comparação do segredo do cron;
- cache do health;
- validação do backup;
- compatibilidade com a Vercel e o Neon:
  - advisory locks e `set_config(..., true)` são de **transação**, compatíveis com o pooler (PgBouncer) do Neon;
  - `hashtextextended` existe desde o PostgreSQL 11;
  - `after()` é suportado na Vercel.

### Evidências (antes → depois)

| Cenário | Antes | Depois |
|---|---|---|
| 30 logins simultâneos, banco em `READ COMMITTED` | 5 | 5 |
| 30 logins simultâneos, banco em `REPEATABLE READ` | 14 | 5 |
| Trava presa por 4–8 s: espera de outra consulta do app | ~7 s | ~0,8 s |
| Rotação de IPv6 no mesmo /64 | 30 | 5 |
| Action sem login como arrow function | guarda passava | guarda reprova |
| `/renda-fixa/x.png` (logado) | sem CSP | com CSP |
| `/renda-fixa/%E0%A4%A` (logado) | 500 | 400 |

Os testes novos de R1, R2, R3 e R5 **falham no código anterior** e passam no
novo (verificado trocando temporariamente os arquivos).
