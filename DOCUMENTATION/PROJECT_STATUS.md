# Status do Projeto — Bola de Neve

> Atualizar este arquivo ao final de cada etapa: o que foi feito, o que falta e
> problemas conhecidos.

## Resumo

| Etapa | Descrição | Status |
| ----- | --------- | ------ |
| 1 | Fundação e arquitetura | ✅ Concluída (2026-11-20) |
| 2 | Carteira, FIIs e operações financeiras | ✅ Concluída (2026-11-20) |
| 3 | Integrações financeiras e dividendos | ✅ Concluída (2026-11-20) |
| 4 | Motor de simulação Bola de Neve | ✅ Concluída (2026-11-20) |
| 5 | Dashboard, experiência visual e finalização | ✅ Concluída (2026-11-20) |

---

## Etapa 5 — Dashboard, experiência visual e finalização

### Entregue

- **Identidade visual:**
  - tema escuro azul-marinho com roxo profundo, ações em laranja e verde/vermelho para resultados;
  - cards com acabamento sutil, tipografia com números tabulares e animações discretas (respeitam `prefers-reduced-motion`).
- **Menu lateral com as 11 seções**, cada uma levando a uma página funcional, com item ativo destacado. No celular, vira uma gaveta acessível (Esc fecha; sem rolagem horizontal em nenhuma página).
- **Visão geral (do banco):**
  - patrimônio, capital investido, lucro/prejuízo, rentabilidade e quantidade de cotas;
  - dividendos do mês, do ano, acumulados e média mensal de 12 meses;
  - renda passiva recorrente estimada e progresso das metas;
  - gráficos: evolução patrimonial (reconstruída de operações e cotações; meses sem dado ficam indisponíveis, nunca estimados), dividendos, aportes e distribuição por fundo e segmento.
- **Análise da carteira**: pesos, concentração, resultados, DY, YoC e renda por fundo.
- **Análise individual**: cartões pesquisáveis por ticker. A página do fundo ganhou último rendimento e próximo provento anunciado ("Aguardando divulgação." quando não há).
- **Simulador:**
  - seleção de fundos da carteira (cópia de valores);
  - seleção de cenários e de métrica nos gráficos;
  - comparação de estratégias (configurada, 100%, 0%, concentrar no maior pagador);
  - duplicar um cenário como nova simulação;
  - **destaque das cotas compradas só com dividendos** (cartão, coluna na tabela e gráfico por mês).
- **Metas:**
  - renda mensal, patrimônio, cotas e personalizadas;
  - progresso, valor restante e prazo estimado pela simulação escolhida (hipotético);
  - editar e excluir com confirmação.
- **Calendário de proventos:**
  - grade mensal e lista;
  - confirmados (anúncio oficial) × estimativas (previsões);
  - valores esperados pela posição na data-com, próximos pagamentos e histórico.
- **Central de dados:**
  - integrações, histórico de atualizações, origem dos dados (manual × automático);
  - exportação **CSV** (pt-BR, protegida contra fórmulas) e **Excel .xlsx** por conjunto ou completa;
  - **backup JSON** com checksum, sem credenciais;
  - **restauração** (só em conta vazia, transacional, novos IDs, ledger revalidado).
- **Configurações:**
  - perfil;
  - troca de senha (exige a atual; encerra todas as sessões);
  - sessões ativas e encerramento das outras;
  - atualização automática.
- **Experiência:**
  - carregamento (esqueleto), erro com "tentar novamente" e "não encontrado";
  - mensagens de sucesso e erro nos formulários, confirmações de exclusão;
  - tooltips explicativos nos indicadores, estados vazios, filtros e pesquisa por ticker.
- **Segurança** (detalhes em [`SECURITY.md`](SECURITY.md)):
  - CSP com nonce por requisição (verificada no navegador sem violações);
  - todas as rotas e ações revisadas;
  - exportação e backup protegidos por sessão.
- **Produção:**
  - `npm run db:backup` (pg_dump; restauração testada em banco novo);
  - [`DEPLOYMENT.md`](DEPLOYMENT.md) e [`USER_GUIDE.md`](USER_GUIDE.md).

### Mudanças no banco

| Migração | Conteúdo |
| -------- | -------- |
| `…_financial_goals` | Tabela `financial_goals` e enum `goal_metric` (simulação vinculada com `ON DELETE SET NULL`) |

### Testes executados (2026-11-20)

| Verificação | Resultado |
| ----------- | --------- |
| TypeScript (`npm run typecheck`) | ✅ sem erros |
| ESLint | ✅ sem erros/avisos |
| Unitários | ✅ 168/168 (inclui simulador, exemplo das 96 cotas, histórico da carteira, metas, CSV/XLSX, estratégias, CSP) |
| Integração (PostgreSQL) | ✅ 57/57 (inclui visão geral, metas, backup ida e volta, restauração recusada/adulterada, escopo de exportações, sessões) |
| E2E (Playwright, build de produção) | ✅ 32/32 |
| Build de produção | ✅ |
| Backup do banco (pg_dump → pg_restore em banco novo) | ✅ |
| `npm audit` | ✅ 0 vulnerabilidades |

Os E2E percorrem o menu completo (desktop e celular) e os fluxos pedidos:

| Fluxo | Resultado |
| ----- | --------- |
| Login | ✅ |
| Cadastro de fundo | ✅ |
| Compra | ✅ |
| Venda | ✅ |
| Consulta e atualização de cotação | ✅ |
| Cadastro de dividendos | ✅ |
| Visualização da carteira e visão geral | ✅ |
| Criação de simulação | ✅ |
| Reinvestimento | ✅ |
| Salvamento e persistência (inclusive reinício do servidor) | ✅ |
| Metas, calendário, exportação, backup e configurações | ✅ |

### Problemas encontrados e soluções

| Problema | Solução |
| -------- | ------- |
| Menu lateral "preso" no topo | O `backdrop-filter` do cabeçalho criava um bloco de contenção para `fixed`; o menu foi movido para fora do cabeçalho |
| Rolagem horizontal no celular em páginas com tabelas | `.grid > * { min-width: 0 }`; as tabelas rolam no próprio contêiner |
| Calendário somava R$ 0,00 quando a quantidade elegível era desconhecida | Passa a indicar "sem valor conhecido" em vez de somar zero |
| Testes com expectativa errada (12 × 1,10 = 13,20, não 11,00) | O sistema estava certo; expectativa do teste corrigida |
| Testes E2E antigos afetados por novas colunas e botões | Seletores e valores atualizados |
| Ambiente reiniciado durante a etapa (PostgreSQL parado) | Banco religado; migrações e dados conferidos; trabalho preservado e commitado |

---

## Estado final do projeto

- **Banco:** 10 migrações versionadas. Tabelas:
  - carteira: `funds`, `operations`, `positions`, `price_quotes`, `daily_prices`;
  - proventos: `dividend_events`, `dividend_receipts`;
  - simulador e metas: `simulations`, `simulation_versions`, `financial_goals`;
  - sistema: `sync_runs`, `user_settings`, `audit_events`;
  - autenticação: `users`, `sessions`, `login_attempts`.
- **Integrações disponíveis:**
  - brapi: cotação, fechamentos diários, proventos e cadastro; sem chave, só os fundos de teste MXRF11/HGLG11;
  - B3 FundosNET: avisos oficiais de rendimentos, exige CNPJ.
- **Pendências e limitações:**
  - sem custos, impostos ou eventos corporativos (desdobramento/grupamento/amortização no custo);
  - sem 2FA;
  - feriados não são considerados em "desatualizada" nem no calendário do simulador;
  - a evolução patrimonial só existe a partir dos registros (o saldo inicial vale desde o dia do cadastro);
  - a FundosNET pode bloquear temporariamente consultas automáticas;
  - sem `BRAPI_API_KEY`, a cotação é o fechamento anterior;
  - `style-src 'unsafe-inline'` na CSP.
- **Deploy:** não realizado (requer servidor, banco e credenciais); procedimento em [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## Etapa 4 — Motor de simulação Bola de Neve

### Entregue

- **Motor puro e determinístico** (`src/domain/simulation`):
  - camadas separadas: configuração, premissas, cálculo mês a mês, resultados mensais e acumulados, marcos e cenários;
  - Decimal em tudo, caixa em centavos exatos, sem aleatoriedade.
- **Modelos de tempo:**
  - **mensal simplificado** (padrão): cotas compradas no mês só rendem a partir do mês seguinte (premissa documentada);
  - **calendário**: data-com, pagamento e defasagem por fundo; dia de compra configurável.
- **Premissas:**
  - vários fundos, cada um com quantidade, preço, dividendo, variação (constante, mensal, anual) e alterações pontuais;
  - reinvestimento por fundo (100/75/50/25/0%), com a parte não reinvestida contabilizada à parte;
  - saldo inicial, aporte mensal e aportes extraordinários com destino opcional.
- **Distribuição dos recursos:** mesmo fundo, percentuais (inclui "fundo específico") ou escolha manual com caixa comum. Somente cotas inteiras; o troco nunca é descartado.
- **Marcos:** 1ª cota só com dividendos; 1ª compra de 2, 5 e 10 cotas; dividendos acima do aporte; R$ 50, 100, 500 e 1.000 de renda; objetivos personalizados.
- **Cenários hipotéticos** (referência constante, conservador, moderado e otimista) com premissas editáveis.
- **Persistência separada da carteira:**
  - salvar, editar (com histórico de versões e restauração), duplicar e excluir;
  - importar a carteira real como **cópia**, com avisos quando falta cotação ou dividendo.
- **Interface:**
  - lista de simulações;
  - editor com prévia instantânea (mesmo schema e mesmo motor do servidor);
  - resultados com resumo, premissas, marcos, tabela mensal (consolidada e por fundo) e comparação de cenários (gráfico + tabela);
  - 6 gráficos: cotas, renda passiva, patrimônio, dividendos × aportes, saldo acumulado e cenários. Paleta validada pela checagem automática de cores; tabela com os mesmos dados.

### Mudanças no banco

| Migração | Conteúdo |
| -------- | -------- |
| `…_simulations` | Tabelas `simulations` e `simulation_versions` (configuração JSON, resumo, versão do motor), sem chaves para tabelas da carteira |

### Testes executados (2026-11-20)

| Verificação | Resultado |
| ----------- | --------- |
| TypeScript, ESLint, build, `npm audit` | ✅ |
| Unitários | ✅ 157/157 (40 novos do simulador) |
| Integração (PostgreSQL) | ✅ 51/51 (6 novos: ciclo completo, validação, isolamento entre usuários, persistência, importação, **isolamento da carteira real**) |
| E2E | ✅ 22/22 (3 novos: exemplo das 96 cotas pela interface, edição/versões/duplicar/excluir, importação sem alterar a carteira) |

Os testes obrigatórios estão cobertos:

| Tema | Cobertura |
| ---- | --------- |
| Exemplo das 96 cotas (meses 1–4, valor a valor) | ✅ |
| Saldo acumulado | ✅ |
| Cotas inteiras | ✅ |
| Reinvestimento integral e parcial | ✅ 100/75/50/25/0% |
| Sem aportes e com aportes extraordinários | ✅ |
| Alteração de preços e de dividendos | ✅ |
| Vários fundos | ✅ 4 estratégias |
| Elegibilidade | ✅ mensal e calendário, antes/depois da data-com |
| Marcos | ✅ |
| Prazos diferentes | ✅ o prazo maior estende o menor sem alterá-lo |
| Isolamento da carteira real | ✅ fotografia completa das tabelas da carteira idêntica antes/depois |

### Problemas encontrados e soluções

| Problema | Solução |
| -------- | ------- |
| Um teste esperava patrimônio de R$ 1.968,80 | Era erro na conta manual do teste (97 × 20 + 8,80 = 1.948,80); o motor estava certo e o teste foi corrigido |
| Mensagem de erro duplicada em formulários com erro por campo | Restaurado o comportamento anterior; o simulador mostra a primeira mensagem do Zod |
| Cenários iguais à referência em prazos ≤ 12 meses | Comportamento correto (taxa anual vale a partir do mês 13), agora explicado na tela |

### Limitações

- Sem custos de compra (corretagem/emolumentos), impostos ou eventos corporativos.
- Calendário sem dias úteis/feriados (dias 1–28).
- Preços e dividendos são premissas; o motor não usa séries históricas nem aleatoriedade.
- A importação da carteira usa o último rendimento oficial pago como dividendo mensal. Fundos sem histórico recebem 0, com aviso.
- O "patrimônio" exclui o valor não reinvestido (considerado retirado).

### Próxima etapa (não iniciada)

Aguardando validação do simulador.

---

## Etapa 3 — Integrações financeiras e dividendos

### APIs avaliadas

| Fonte | Resultado |
| ----- | --------- |
| brapi (documentação oficial + chamadas reais) | **Implementada**: cotação, fechamentos diários, proventos e dados cadastrais |
| B3 FundosNET (documentos oficiais dos administradores) | **Implementada** como fonte oficial de proventos (exige CNPJ; site com proteção anti-robô) |
| CVM — dados abertos (informe mensal de FII) | Avaliada; **não usada**: só tem percentuais mensais, sem valor por cota nem datas |

Detalhes, limites e particularidades: [`INTEGRATIONS.md`](INTEGRATIONS.md).

### Entregue

- **Provedores independentes:**
  - `PriceProvider`, `DividendProvider` e `AssetInformationProvider`;
  - implementações brapi e B3 FundosNET;
  - registro configurável por variáveis de ambiente;
  - erros categorizados, timeout, controle de requisições (concorrência, intervalo, `Retry-After`) e cache com TTL.
- **Cotações:**
  - consulta por ticker, com cotação atual, fechamento anterior, variação do dia e horário de mercado;
  - fallback identificado ("Fechamento · brapi") quando a cotação atual não é liberada pelo plano;
  - fechamentos diários com gráfico;
  - origem visível (Manual / Automática / Fechamento) e selo "Desatualizada";
  - falhas nunca sobrescrevem nem zeram dados.
- **Atualizações:**
  - botões manuais;
  - automática configurável por usuário, em segundo plano (`after()`);
  - endpoint agendado `/api/cron/refresh` com `CRON_SECRET`;
  - registro de cada execução e tela "Integrações" com última tentativa, último sucesso e detalhes.
- **Proventos:**
  - eventos oficiais (anunciado/pago) e previsões, com recebimentos "recebido e registrado";
  - cadastro manual e importação automática (brapi + B3);
  - prevenção de duplicidade (índices únicos, divergências reportadas, nada sobrescrito);
  - anulação com motivo;
  - triggers impedem exclusão e alteração.
- **Quantidade elegível:** pelo histórico na data-com. O saldo inicial só vale a partir do dia em que foi registrado; antes disso, a elegibilidade é desconhecida e o usuário informa a quantidade.
- **Cálculos:**
  - valor do provento;
  - total recebido, últimos 12 meses e renda passiva mensal (12m ÷ 12);
  - média mensal desde o início;
  - histórico mensal (gráfico + tabela) e anual;
  - por fundo;
  - DY 12m e yield on cost, com regra de dados suficientes.
- **Próximos pagamentos:** só anúncios oficiais; previsões em coluna separada; "Aguardando divulgação." quando não há anúncio.
- **Dados cadastrais:** consulta à brapi apresentada como sugestão; o usuário aplica campo a campo (nome, segmento, CNPJ).
- **Diagnóstico:** `npm run integrations:check` (chamadas reais, sem gravar).

### Mudanças no banco (4 migrações)

| Migração | Conteúdo |
| -------- | -------- |
| `…_integrations_dividends` | `funds.cnpj`; novos campos em `price_quotes` (horário de mercado, fechamento anterior, variação); tabelas `daily_prices`, `dividend_events`, `dividend_receipts`, `sync_runs`, `user_settings`; enums de origem/natureza/tipo |
| `…_dividends_integrity` | CHECKs; índice único da leitura automática de cotação; índice único parcial de proventos ativos; um recebimento ativo por evento; triggers de não exclusão e imutabilidade |
| `…_dividend_rate_precision` / `…_receipt_rate_precision` | valor por cota com 10 casas (documentos oficiais usam 9) |

### Testes executados (2026-11-20)

| Verificação | Resultado |
| ----------- | --------- |
| TypeScript, ESLint, build | ✅ |
| Unitários | ✅ 117/117 (42 novos: proventos, atualidade de cotação, provedores com respostas simuladas, cache, limitador) |
| Integração (PostgreSQL) | ✅ 45/45 (17 novos: cotações, falhas, cache, desatualização, importação, duplicidade, elegibilidade, recebimentos, persistência, atualização automática) |
| E2E | ✅ 19/19 (4 novos: proventos pela interface; integrações desligadas no E2E) |
| Integração real (brapi e B3) | ✅ MXRF11/HGLG11: cotação (fechamento), cadastro, 13 proventos de cada, avisos oficiais da B3 conferindo com a brapi; KNRI11 → 401 sem chave (esperado) |
| `npm audit` | ✅ 0 vulnerabilidades |

Respostas simuladas existem **somente** nos testes (`tests/unit/providers.test.ts` e os provedores falsos de `tests/integration/market-dividends.test.ts`).

### Problemas encontrados e soluções

| Problema | Solução |
| -------- | ------- |
| Sem chave, a brapi não libera a cotação atual de FIIs (401) | Fallback para o último fechamento diário, identificado como tal; com `BRAPI_API_KEY` usa a cotação atual |
| Endpoints de FII da brapi são do plano Pro (sem chave, só MXRF11/HGLG11) | Documentado; FundosNET cobre proventos oficiais de qualquer fundo com CNPJ |
| B3 FundosNET bloqueia rajadas (Cloudflare: 403/HTML) | 1 requisição a cada 5 s, poucos documentos, sem baixar de novo documentos já importados; bloqueio tratado como indisponibilidade |
| Amortização com 9 casas decimais | Valor por cota ampliado para 10 casas |
| `relatedTo` sem ano ("OUTUBRO") | Competência fica vazia; o texto original é exibido |
| Dados cadastrais divergentes na fonte (MXRF11 "Logística" × "papel") | Nada é gravado automaticamente; sugestões com aplicação campo a campo |
| `fetch` do Node não usa proxy HTTP do ambiente de desenvolvimento | `NODE_USE_ENV_PROXY=1` apenas neste ambiente (documentado) |

### Pendências e limitações conhecidas

- Sem `BRAPI_API_KEY`:
  - só há dados automáticos para MXRF11 e HGLG11;
  - a cotação é o último fechamento diário, que pode vir 1 pregão atrasado e aparece como "Desatualizada".
- Fundos fora do sandbox exigem chave da brapi (proventos/histórico/cadastro de FII são do plano Pro) ou CNPJ cadastrado para os avisos da B3.
- A atualização automática roda quando alguém abre o sistema. Para horários fixos, configure `CRON_SECRET` e um agendador externo.
- Feriados não entram no cálculo de "desatualizada".
- Amortizações não ajustam o custo médio (etapa de eventos corporativos).
- Na carteira real registrada na Etapa 2, os proventos com data-com **anteriores** ao registro do saldo inicial aparecem com elegibilidade desconhecida. Confirme-os informando a quantidade que você tinha (o sistema não supõe).
- No banco de desenvolvimento deste ambiente, o usuário `verificacao@local.dev` recebeu proventos e cotações reais importados durante a verificação.

### Próxima etapa (não iniciada)

Aguardando validação desta etapa.

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
