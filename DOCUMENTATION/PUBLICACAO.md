# Publicação segura — checklist (Neon + Vercel)

Guia para publicar a branch `security/auditoria` e aplicar as configurações
externas pendentes do `SECURITY.md`, **em ordem**, sem derrubar o site e sem
perder o acesso ao banco.

- Fontes conferidas na documentação oficial do Neon e da Vercel em 2026-11-26.
- Permissões do banco validadas localmente: os 45 testes de tela passaram com o
  app usando um papel limitado idêntico ao proposto aqui.
- **Não há migração** nesta publicação nem variável de ambiente nova.

> Regras de ouro
>
> - Senhas e URLs de banco vão para um **gerenciador de senhas**. Nunca para chat, e-mail ou arquivo versionado.
> - Faça **uma fase por vez** e só avance quando a conferência da fase der certo.
> - Se algo der errado, use a seção [Como desfazer](#como-desfazer).

---

## Fase 0 — Preparação (não muda nada no ar)

- [ ] Gerenciador de senhas pronto (Bitwarden, 1Password ou o do navegador).
- [ ] 2FA ligado nas contas do **GitHub**, da **Vercel** e do **Neon**.
- [ ] No Neon, anote:
  - o nome da branch de produção (`production`);
  - o nome do banco, que é o trecho depois da última `/` da URL, normalmente `neondb`.
- [ ] Neon → projeto → **Settings**: confira a janela de histórico (restauração a um ponto no tempo) disponível no seu plano.
- [ ] Tire um print do **dashboard** do app (patrimônio, quantidades), para comparar depois.

## Fase 1 — Isolar os Previews (fazer PRIMEIRO)

Cada push numa branch que não é a `main` gera um deploy de **Preview** na
Vercel, que usa as variáveis do ambiente *Preview*. Se `DATABASE_URL` valer
para Preview, esses deploys usam o **banco de produção**.

1. [ ] Vercel → seu projeto → **Environment Variables** (na barra lateral; em versões antigas do painel, dentro de **Settings**) → localize `DATABASE_URL`.
   - Se estiver marcada para **Preview** ou **Development**: **⋯ → Edit** → deixe **só Production** → **Save**.
   - Se a variável foi criada por uma **integração do Neon** (aparece como gerenciada pela integração), abra **Integrations** (ou **Storage**) → Neon e retire o ambiente **Preview** da conexão.
     - Observação: a "preview branching" automática do Neon cria, a cada Preview, uma cópia do banco **com os dados reais**.
2. [ ] **Settings** → **Deployment Protection** (ou **Deployment Protection** direto na barra lateral) → **Vercel Authentication**:
   - ligue;
   - escolha **Standard Protection** (protege tudo, menos o domínio de produção);
   - **Save**.
   - Disponível em todos os planos. O app não usa `VERCEL_URL`, então nada quebra.
3. [ ] Deploys de Preview antigos guardam as variáveis da época (mudanças só valem para deploys novos).
   - Em **Deployments**, apague os Previews antigos de que não precisa: **⋯ → Delete**.
   - Os que sobrarem ficam protegidos pelo item 2 e, depois da Fase 4, com a senha antiga inválida.
4. [ ] Opcional: se aparecer em **Settings da equipe → Security** a política **Separate Production Secret Values**, ligue-a. Ela impede que a produção use o mesmo segredo dos outros ambientes.

✅ **Conferência:**
- um link de Preview, aberto numa janela anônima, pede login da Vercel;
- o site de produção continua abrindo normalmente.

> Sem `DATABASE_URL`, o Preview compila (testado) e mostra a tela de login, mas
> não consegue entrar. É o comportamento seguro desejado. Um banco próprio para
> Preview, como uma *branch só com estrutura* do Neon, sem dados, pode ser
> configurado depois.

## Fase 2 — Criar o usuário do banco com permissões limitadas

**Não crie esse usuário pelo Console do Neon.** Papéis criados pelo Console
(ou pela CLI sem `--access`) viram **administradores** (`neon_superuser`, que lê
e grava tudo e cria papéis). Use a CLI com `--access read_write`. Ela também
gera a senha, que aparece **uma única vez** e não fica no histórico do SQL Editor.

1. [ ] No seu computador, no terminal (Node.js instalado), faça login. Abre o navegador para autorizar:
   ```bash
   npx neon@latest login
   ```
2. [ ] Crie o papel (troque `neondb` se o nome do seu banco for outro):
   ```bash
   npx neon@latest roles create --name snowball_app --access read_write --database neondb --schema public --branch production
   ```
   - Se a CLI pedir o projeto, acrescente `--project-id SEU_ID`. O ID está em Neon → projeto → **Settings** → **General**.
   - **Copie a senha exibida** para o gerenciador de senhas. Ela não aparece de novo.
   - O que este papel pode: `SELECT/INSERT/UPDATE/DELETE` nas tabelas do dono do banco, **inclusive as que as migrações criarem no futuro**. Ele não cria tabelas, não altera o schema e não cria papéis.
3. [ ] Neon → **SQL Editor** → branch **production**, banco **neondb**. Execute o SQL abaixo (não contém senha):
   ```sql
   -- Sequência usada ao registrar operações (sem isto, registrar operações falha):
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snowball_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO snowball_app;
   -- O app não deve ler nem alterar o histórico de migrações:
   REVOKE ALL ON TABLE _prisma_migrations FROM snowball_app;
   -- A auditoria é somente-inserção:
   REVOKE UPDATE, DELETE ON audit_events FROM snowball_app;
   ```
4. [ ] Conferência, também no SQL Editor (só leitura):
   ```sql
   SELECT
     has_table_privilege('snowball_app', 'operations', 'INSERT')                       AS insere_operacoes,
     has_sequence_privilege('snowball_app', 'public.operations_sequence_seq', 'USAGE') AS usa_sequencia,
     has_table_privilege('snowball_app', 'login_attempts', 'DELETE')                   AS limpa_tentativas,
     has_table_privilege('snowball_app', '_prisma_migrations', 'SELECT')               AS le_migracoes,
     has_table_privilege('snowball_app', 'audit_events', 'DELETE')                     AS apaga_auditoria,
     pg_has_role('snowball_app', 'neon_superuser', 'MEMBER')                           AS administrador;
   ```
   ✅ Esperado: `true`, `true`, `true`, `false`, `false`, `false`.

As **migrações não são afetadas**: continuam sendo aplicadas por você, com o
dono do banco (`neondb_owner`) e a URL **direta**. O app nunca roda migrações:
o build da Vercel é só `next build`.

## Fase 3 — Passar a produção para o usuário limitado (código atual, ainda sem o merge)

Trocar o usuário do banco **antes** do merge separa os riscos: se algo falhar,
você sabe que foi a permissão, não o código novo.

1. [ ] Monte a URL do novo usuário com **pooling**:
   - Neon → **Connect**;
   - Branch `production`, Database `neondb`, Role `snowball_app`, **Connection pooling ligado** (o host tem `-pooler`).
   - Se a senha não aparecer preenchida, coloque a que você guardou na Fase 2. O formato é:
     ```text
     postgresql://snowball_app:SENHA@HOST-pooler.REGIÃO.aws.neon.tech/neondb?sslmode=require
     ```
   - Mantenha os mesmos parâmetros (o que vem depois do `?`) da URL que hoje está na Vercel.
2. [ ] Vercel → projeto → **Environment Variables** → `DATABASE_URL`:
   - **⋯ → Edit** → cole a nova URL;
   - ambiente **só Production**;
   - se houver a opção **Secret**, use-a (o valor passa a ser somente escrita);
   - **Save**.
3. [ ] Vercel → **Deployments** → deploy de produção atual → **⋯ → Redeploy**. Variáveis só valem para deploys novos.
4. [ ] ✅ **Conferência** (com o novo deploy "Ready"):
   - entrar no app;
   - o dashboard mostra os mesmos valores do print;
   - criar uma meta de teste e excluí-la;
   - abrir Renda fixa e o Simulador;
   - Vercel → **Logs**: nenhum erro de `permission denied`.

## Fase 4 — Trocar a senha vazada do dono do banco

A URL de uma branch de teste foi colada numa conversa anterior. No Neon, uma
branch nova **recebe uma cópia dos papéis da branch de origem**, e a troca de
senha **vale só para a branch em que é feita**. Por isso apagar a branch de
teste **não** invalida a senha na produção: se a branch foi criada a partir da
produção, a senha do `neondb_owner` é provavelmente a mesma. Agora que o app não
usa mais o `neondb_owner` (Fase 3), a troca não derruba o site.

1. [ ] Neon Console → seu projeto → no menu de branch do topo da barra lateral, escolha **production** → **Postgres database → Roles** → no menu do `neondb_owner`, **Reset password** → **Reset**.
   - Copie a nova senha para o gerenciador. Ela vale imediatamente; a antiga para de funcionar na próxima conexão.
2. [ ] No seu computador, atualize a URL **direta** usada para migrações (`.env` local ou o gerenciador de senhas) com a nova senha.
3. [ ] Neon → **Branches**:
   - confirme que a branch de teste do chat **não existe mais** (se existir, **Delete**);
   - em outras branches que você não usa, apague-as ou troque a senha do `neondb_owner` nelas também.
4. [ ] ✅ **Conferência:**
   - com a nova URL direta: `npx prisma migrate status` → "Database schema is up to date";
   - o site continua funcionando (usa o `snowball_app`).

## Fase 5 — Merge do PR (publicação do código)

1. [ ] Revise o PR `security/auditoria → main` no GitHub e faça o **merge**. A Vercel publica sozinha.
2. [ ] Aguarde o deploy de produção ficar **Ready**.
3. [ ] ✅ Faça as [verificações pós-deploy](#verificações-pós-deploy).

## Fase 6 — Reforços opcionais

- [ ] GitHub → **Settings** → **Rules/Branches**: na `main`, exigir Pull Request antes do merge.
- [ ] GitHub → **Settings** → **Code security**: ativar Dependabot alerts e, se disponível no seu plano/repositório, secret scanning.
- [ ] Vercel → **Firewall** → **New Rule**: rate limit para `POST /login`.
  - Disponível em todos os planos, mas a Vercel mostra um aviso de **preço** antes de criar a primeira regra.
  - Reduz o risco de bloqueio do login por terceiros.
- [ ] Banco de Preview sem dados reais: branch "só estrutura" (*schema-only*) do Neon, ligada só ao ambiente Preview, e um usuário de teste próprio.

---

## Verificações pós-deploy

Só leitura. Podem ser repetidas a qualquer momento.

| # | Verificação | Como | Esperado |
|---|---|---|---|
| 1 | Saúde | abrir `/api/health` | `{"status":"ok","database":"up"}` |
| 2 | Login e logout | entrar e sair | funciona |
| 3 | Dados intactos | dashboard × print da Fase 0 | mesmos valores |
| 4 | Redirecionamento externo bloqueado | sem login, abrir `/login?next=%2F%09%2Fevil.example`, entrar | cai no **próprio site** (`/dashboard`) |
| 5 | Cabeçalhos | ferramentas do navegador → Rede → resposta de `/login` | `content-security-policy` com `nonce-`, `x-frame-options: DENY`, `strict-transport-security` |
| 6 | CSP em todas as páginas | resposta de `/renda-fixa/x.png` | tem `content-security-policy` |
| 7 | URL malformada | abrir `/renda-fixa/%E0%A4%A` | **400** (não 500) |
| 8 | APIs sem login | janela anônima: `/api/backup`, `/api/export/tudo` | **401** |
| 9 | Cron desligado | `/api/cron/refresh` | **404** |
| 10 | Limite de tentativas | com um e-mail que **não existe**, errar a senha 6 vezes | a 6ª mostra "Muitas tentativas" (não afeta a sua conta) |
| 11 | Preview protegido | link de Preview em janela anônima | pede login da Vercel |
| 12 | Logs | Vercel → **Logs**, filtrar por erro | sem `permission denied` nem erros novos |

O Claude consegue repetir as verificações 1, 4 (parte sem login), 5, 6, 7, 8 e 9
pelo terminal, só lendo, quando você autorizar.

## Como desfazer

- **Código (Fase 5):** Vercel → **Overview** do projeto → bloco *Production Deployment* → **Instant Rollback**.
  - No plano gratuito, volta para o deploy **imediatamente anterior**: o da Fase 3, com o usuário limitado e o código antigo.
  - O rollback reutiliza o build anterior com as variáveis da época.
- **Usuário do banco (Fase 3):** antes da Fase 4, recoloque a URL antiga em `DATABASE_URL` (Production) e faça **Redeploy**.
  - Depois da Fase 4, use a URL do `neondb_owner` com a **senha nova**.
- **Permissões (Fase 2):** o papel pode ser removido.
  - Neon → **Roles** → `snowball_app` → **Delete**; ou, no SQL Editor: `DROP OWNED BY snowball_app; DROP ROLE snowball_app;`.
  - Só faça isso depois que a produção não usar mais o papel.
