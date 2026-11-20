# Regras Financeiras — Bola de Neve

Este documento é a referência para **todo** cálculo financeiro da plataforma.
Cada regra implementada aponta para o módulo em `src/domain` que a implementa
e para os testes que a verificam.

> **Princípio:** a plataforma nunca inventa informação financeira. Preços,
> proventos, datas e indicadores vêm do usuário ou de fontes externas
> identificadas. Na ausência de dado, exibe-se "indisponível" (—), nunca uma
> estimativa silenciosa.

## Status das regras

| Regra | Status | Módulo | Testes |
| ----- | ------ | ------ | ------ |
| Representação numérica e arredondamento | ✅ Etapa 1 | `src/domain/money.ts` | `tests/unit/money.test.ts` |
| Formatação (R$, %, cotas) e entrada pt-BR | ✅ Etapa 2 | `src/domain/money.ts` | `tests/unit/portfolio-validation.test.ts` |
| Saldo inicial | ✅ Etapa 2 | `src/domain/portfolio/ledger.ts` | `tests/unit/ledger.test.ts` |
| Compra, venda, taxas e preço médio | ✅ Etapa 2 | `src/domain/portfolio/ledger.ts` | `ledger.test.ts`, `portfolio-service.test.ts`, E2E |
| Resultado realizado | ✅ Etapa 2 | `src/domain/portfolio/ledger.ts` | idem |
| Posição, valor atual, não realizado, rentabilidade | ✅ Etapa 2 | `src/domain/portfolio/metrics.ts` | `tests/unit/metrics.test.ts`, E2E |
| Consolidação da carteira | ✅ Etapa 2 | `src/domain/portfolio/metrics.ts` | `metrics.test.ts` |
| Quantidade elegível na data-com | ✅ Etapa 3 | `src/domain/dividends.ts` | `tests/unit/dividends.test.ts`, integração, E2E |
| Valor do provento e status (anunciado/pago/previsto/recebido) | ✅ Etapa 3 | `src/domain/dividends.ts` | idem |
| Histórico de renda (mensal, anual, 12m, médias, por fundo) | ✅ Etapa 3 | `src/domain/dividends.ts` | idem |
| Dividend yield 12m e yield on cost | ✅ Etapa 3 | `src/domain/dividends.ts` | idem |
| Cotação atual e desatualizada | ✅ Etapa 3 | `src/domain/quotes.ts`, `fund-service.ts` | `tests/unit/quote-freshness.test.ts`, integração |
| Eventos corporativos (desdobramento, grupamento, amortização) | ⏳ A definir | — | — |
| Simulador de reinvestimento (mensal e calendário, cenários, marcos) | ✅ Etapa 4 | `src/domain/simulation/` | `tests/unit/simulation.test.ts`, integração, E2E |
| Tributação | ⚠️ Validar em fonte oficial antes de implementar | — | — |

## Precisão e arredondamento

1. **Nunca usar `number` (ponto flutuante) em cálculos financeiros.** Toda
   entrada é convertida para `FinDecimal` (`toDecimal`) a partir de `string`.
   Valores digitados chegam como texto e são normalizados por
   `parseDecimalInput` ("8,44", "1.234,56" ou "8.44").
2. Cálculos intermediários mantêm precisão total (40 dígitos significativos).
3. Arredondamento **apenas** na persistência e na apresentação, com
   **arredondamento comercial (half-up)**: `roundTo`, `roundMoney`.
4. Exceção deliberada: o **valor bruto** de uma compra/venda
   (`quantidade × preço`) é arredondado a centavos, pois representa dinheiro
   efetivamente pago/recebido (`grossAmountOf`).
5. Valores do Prisma (`Prisma.Decimal`) são convertidos com
   `toDecimal(valor.toString())`.

### Escalas (casas decimais)

| Grandeza | Escala | Coluna | Uso |
| -------- | ------ | ------ | --- |
| Valor em reais | 2 | `Decimal(18, 2)` | taxas, valor bruto/líquido, custo vendido e resultado de cada venda |
| Preço unitário | 8 | `Decimal(18, 8)` | preço da operação, preço médio, cotação |
| Provento por cota | 10 | `Decimal(20, 10)` | documentos oficiais trazem até 9 casas (ex.: 0,308363541) |
| Quantidade de cotas | 8 | `Decimal(18, 8)` | hoje validada como **inteira** (FIIs negociam cotas inteiras) |
| Custo total e realizado acumulado (cache da posição) | 12 | `Decimal(30, 12)` | evita perda de precisão entre vendas parciais |
| Taxas e percentuais (fração) | 10 | `Decimal(18, 10)` | reservado |

Limites de entrada: preço com até 8 casas, taxas com até 2 casas, quantidade
inteira > 0.

## Livro-razão (ledger) por fundo

A posição de um fundo **não é editável**: ela é o resultado do
reprocessamento, em ordem, de todas as operações **ativas** do fundo
(`replayLedger`). Estado: `Q` = quantidade, `C` = custo total das cotas em
carteira (inclui taxas de compra), `R` = resultado realizado acumulado.

### Ordem de processamento

1. Saldo inicial (sem data) — sempre primeiro: representa a posição anterior
   a qualquer operação registrada.
2. Depois, por **data do pregão**.
3. Na mesma data, pela **ordem de registro** (`sequence`). Uma correção herda
   a posição da operação que corrige.

### Saldo inicial (`INITIAL_BALANCE`)

- Informado como quantidade + preço médio, **sem data e sem taxas** (o preço
  médio informado já é o custo por cota).
- `Q = quantidade`; `C = quantidade × preço_médio` **exato** (sem arredondar,
  para preservar o preço médio informado).
- No máximo um saldo inicial ativo por fundo.

### Compra (`BUY`)

```
bruto   = round2(quantidade × preço)
líquido = bruto + taxas                      (desembolso total)
C       = C + líquido
Q       = Q + quantidade
PM      = C / Q                              (recalculado)
```

### Venda (`SELL`)

```
bruto            = round2(quantidade × preço)
líquido          = bruto − taxas             (valor recebido; não pode ser negativo)
custo_vendido    = C × quantidade / Q        (= PM anterior × quantidade, sem erro de arredondamento)
resultado        = líquido − custo_vendido   (realizado; positivo = lucro)
C                = C − custo_vendido         (C = 0 exato se Q zerar)
Q                = Q − quantidade
R                = R + resultado
```

- O **preço médio das cotas remanescentes não muda** com a venda.
- A venda é rejeitada se `quantidade > Q` **na data da operação** (inclusive
  quando a venda é retroativa ou quando uma correção/cancelamento posterior
  tornaria o histórico inconsistente).
- O resultado de cada venda é gravado na própria operação (arredondado a
  centavos, `realized_result`); o acumulado da posição usa precisão total e é
  arredondado só na exibição. Por isso a soma dos resultados arredondados de
  várias vendas pode diferir do total exibido em até R$ 0,01 por venda.

### Exemplo conferido manualmente

| Operação | Q | C | PM | Realizado |
| -------- | - | - | -- | --------- |
| Saldo inicial 31 × 8,44 | 31 | 261,64 | 8,44 | — |
| Compra 10 × 8,50 + 0,30 | 41 | 346,94 | 8,46195122 | — |
| Compra 9 × 8,30 + 0,25 | 50 | 421,89 | 8,4378 | — |
| Venda 20 × 8,60 − 0,40 (líquido 171,60; custo 168,756) | 30 | 253,134 | 8,4378 | +2,844 |
| Venda 30 × 8,20 − 0,35 (líquido 245,65; custo 253,134) | 0 | 0 | — | −7,484 |
| **Total realizado** | | | | **−4,64** |

## Métricas da posição (`computePositionMetrics`)

| Métrica | Fórmula |
| ------- | ------- |
| Quantidade atual | `Q` |
| Preço médio | `C / Q` (indisponível se `Q = 0`) |
| Capital investido | `C` (custo das cotas em carteira, com taxas de compra) |
| Valor atual | `Q × cotação_atual` |
| Resultado não realizado | `valor_atual − C` |
| Rentabilidade | `resultado_não_realizado / C` |
| Resultado realizado | `R` |
| Resultado total | `R + resultado_não_realizado` |

- **Cotação atual** = cotação mais recente registrada para o fundo. Nesta
  etapa todas são **manuais** (`source = MANUAL`): valores de referência
  digitados pelo usuário, identificados como "Manual" na interface, com data
  de registro e, se informada, data de referência. Sem cotação, valor atual,
  resultado não realizado e rentabilidade ficam indisponíveis.
- Rentabilidade refere-se às cotas em carteira (não inclui realizado nem
  proventos).

### Carteira (`computePortfolioTotals`)

- Capital investido e realizado: soma de todas as posições não arquivadas.
- Valor atual e não realizado: soma das posições **com cotação**; posições
  sem cotação são contadas e sinalizadas.
- Rentabilidade da carteira = não realizado ÷ capital investido das posições
  com cotação.

Carteira inicial informada (cotações manuais):

| Fundo | Q | PM | Investido | Cotação | Valor | Resultado | Rentab. |
| ----- | - | -- | --------- | ------- | ----- | --------- | ------- |
| MXRF11 | 31 | 8,44 | 261,64 | 8,52 | 264,12 | +2,48 | +0,95% |
| HGLG11 | 1 | 145,00 | 145,00 | 141,80 | 141,80 | −3,20 | −2,21% |
| **Total** | | | **406,64** | | **405,92** | **−0,72** | **−0,18%** |

## Integridade das operações

- Operações são **imutáveis**: quantidade, preço, taxas, data e tipo não
  podem ser alterados (trigger no PostgreSQL).
- **Correção** = nova operação (`corrects_id` → original) + original marcada
  `SUPERSEDED`, com motivo obrigatório.
- **Cancelamento** = status `CANCELED`, com motivo obrigatório.
- Operações **nunca são excluídas** (trigger bloqueia `DELETE`).
- Toda alteração roda em transação com lock do fundo e termina com o
  reprocessamento completo; se o histórico ficar inconsistente, nada é gravado.
- Fundos não são excluídos: "remover" = arquivar, exigindo posição zerada.

## Proventos (Etapa 3)

### Natureza e status

| Status exibido | Regra |
| -------------- | ----- |
| **Anunciado** | evento oficial (fonte oficial/brapi ou cadastro manual "anunciado") com pagamento futuro ou sem data |
| **Pago pelo fundo** | evento oficial cuja data de pagamento já chegou |
| **Previsto (estimativa)** | cadastrado pelo usuário como previsão; nunca exibido como anúncio, não pode ser "recebido" |
| **Recebido e registrado** | existe um recebimento ativo registrado pelo usuário para o evento |

Sem anúncio oficial com pagamento futuro para um fundo: **"Aguardando divulgação."**

### Quantidade elegível

- Tem direito quem possui a cota **ao final da data-com**.
- Quantidade elegível = posição após reprocessar apenas as operações ativas com data de pregão **≤ data-com**:
  - compra na data-com conta;
  - venda na data-com tira o direito.
- **Nunca** se usa a quantidade atual retroativamente.
- **Saldo inicial** (sem data de aquisição): só é considerado para datas-com **a partir do dia em que foi registrado** (primeiro registro, mesmo que depois corrigido). Para datas-com anteriores, a elegibilidade é **desconhecida**. O recebimento só pode ser registrado se o usuário informar a quantidade (origem "MANUAL").

### Valores

- Valor do provento = `round2(quantidade elegível × valor por cota)`, com half-up. Usa-se o valor pago na data (`rawRate` da brapi, `ValorProvento` da B3), sem ajuste por desdobramento.
- Amortizações são registradas, mas **não** entram em renda nem em dividend yield (são devolução de capital).
- Ainda **não** reduzem o custo médio da posição; é uma pendência para a etapa de eventos corporativos.

### Histórico de renda (`summarizeIncome`)

Considera os recebimentos registrados de **rendimentos**, pela data de pagamento, até hoje.

| Indicador | Fórmula |
| --------- | ------- |
| Total recebido | Σ recebimentos |
| Últimos 12 meses | Σ com pagamento **após** (hoje − 12 meses) e até hoje |
| Renda passiva mensal | últimos 12 meses ÷ 12 |
| Média mensal desde o início | total ÷ nº de meses corridos do 1º recebimento até o mês atual (inclusive) |
| Histórico mensal/anual | soma por mês/ano de pagamento; meses sem recebimento aparecem com zero |
| Por fundo | total e últimos 12 meses por fundo |

### Dividend yield (`dividendYield12m`)

- **DY 12m** = Σ rendimentos por cota **oficiais** com pagamento nos últimos 12 meses ÷ cotação atual.
- **Yield on cost 12m** = mesma soma ÷ preço médio.
- **Dados insuficientes** (DY exibido como indisponível):
  - nenhum rendimento oficial registrado;
  - o histórico registrado começa depois de (hoje − 11 meses);
  - não há cotação.
- Previsões e amortizações nunca entram.

### Prevenção de duplicidade

- **Evento:** no máximo um ativo por fundo + natureza + tipo + data-com + data de pagamento (índice único). Na importação:
  - mesmo valor = ignorado;
  - valor ou pagamento diferente = **divergência**: é registrada no log e nada é sobrescrito;
  - fonte que divulga a data de pagamento de um evento antes sem data → o anterior é anulado com motivo e o novo é registrado.
- **Pagamento duplicado:** no máximo um recebimento ativo por evento (índice único).
- Eventos e recebimentos não são excluídos nem alterados (triggers); corrigir = anular com motivo e registrar de novo.

## Definições ainda não implementadas

### Eventos corporativos

Desdobramento, grupamento e amortização alteram quantidade e/ou custo sem
compra/venda e exigirão um tipo de operação próprio — a definir.

## Tributação

Regras tributárias (isenção de rendimentos para pessoa física, imposto sobre
ganho de capital na venda de cotas, DARF, compensação de prejuízos) **não são
implementadas** e mudam com a legislação. O "resultado realizado" calculado
aqui é contábil/gerencial e **não** deve ser usado diretamente como base de
cálculo de imposto. Antes de implementar, cada regra deve ser validada em
fonte oficial (Receita Federal / legislação vigente), com a referência
registrada neste documento.

> Exceção: para a **renda fixa** há uma estimativa de IR regressivo e IOF —
> ver "Renda fixa (pós-fixados)" abaixo. Também é estimativa, não substitui o
> informe do banco.

## Simulador "Bola de Neve" (Etapa 4)

Motor puro e determinístico em `src/domain/simulation` (versão `ENGINE_VERSION` = 1.0.0).
Testes: `tests/unit/simulation.test.ts`, `tests/integration/simulation-service.test.ts` e `tests/e2e/05-simulator.spec.ts`.

> Toda simulação é **hipotética**. Dividendos não são garantidos, preços variam,
> e o resultado decorre apenas das premissas informadas. A simulação **nunca**
> altera a carteira real: a importação copia os valores do dia para uma
> configuração separada.

### Premissas (definidas pelo usuário)

| Premissa | Opções |
| -------- | ------ |
| Fundos participantes | até 20 fundos, cada um com quantidade inicial, preço e dividendo mensal por cota próprios |
| Variação de preço/dividendo (por fundo) | constante (**padrão**); % ao mês composto; % ao ano (aplicado nos meses 13, 25, …); alterações pontuais "a partir do mês X, valor Y" (a variação recomeça da nova base) |
| Reinvestimento (por fundo) | 100%, 75%, 50%, 25% ou 0% |
| Aportes | saldo inicial, aporte mensal e aportes extraordinários (mês, valor, destino opcional) |
| Distribuição dos recursos | ver tabela abaixo |
| Prazo | 1 a 600 meses |
| Modelo de tempo | mensal simplificado ou calendário |

Nenhum crescimento é presumido: tudo começa constante.

| Estratégia | Dividendos reinvestidos | Aportes |
| ---------- | ----------------------- | ------- |
| Mesmo fundo | voltam ao fundo que os gerou | divididos por percentual (ou em partes iguais) |
| Por percentual | divididos por percentual (100% em um fundo = "fundo específico") | divididos por percentual |
| Escolha manual | vão para um caixa comum | vão para o caixa comum; só se compram as cotas planejadas (mês, fundo, quantidade), se houver saldo |

### Modelo mensal simplificado (padrão)

Para cada mês `m` e cada fundo `i`:

```
preço_i(m)       = round2(base × (1 + taxa)^n)            (n conforme a regra de variação)
dividendo_i(m)   = round8(base × (1 + taxa)^n)
elegíveis_i(m)   = cotas_i no INÍCIO do mês m
dividendos_i(m)  = round2(elegíveis_i(m) × dividendo_i(m))   (recebidos no próprio mês)
reinvestido_i(m) = round2(dividendos_i(m) × %reinvestimento_i)
à parte_i(m)     = dividendos_i(m) − reinvestido_i(m)
caixa            = saldo anterior + reinvestido + aportes (conforme a estratégia)
compradas_i(m)   = ⌊caixa_i ÷ preço_i(m)⌋                  (somente cotas inteiras, no FIM do mês)
saldo            = caixa − compradas × preço               (nunca descartado; segue para m+1)
cotas_i(m+1)     = cotas_i(m) + compradas_i(m)
```

- **Premissa documentada:** cotas compradas no mês `m` só geram dividendos a partir do mês `m+1`. Não há dividendo retroativo.
- **Renda mensal** = dividendos recebidos no mês.
- **Renda passiva futura** = Σ round2(cotas finais × dividendo do mês seguinte).
- **Patrimônio** = Σ cotas finais × preço do mês + caixa. O valor "à parte" (não reinvestido) é considerado retirado e fica fora do patrimônio; é contabilizado separadamente.
- O saldo inicial entra como aporte antes do mês 1.
- O caixa é sempre um número exato de centavos. Divisões por percentual truncam em centavos e distribuem os centavos restantes às maiores frações (empate: ordem dos fundos); a soma das partes é sempre igual ao total.

### Modelo calendário (opcional)

Usado quando há datas de pagamento e data-com. Para cada fundo informam-se:

- dia da data-com (1–28);
- dia do pagamento (1–28);
- defasagem em meses entre a data-com e o pagamento.

Também se define o dia das compras e dos aportes. Dentro de cada mês, os eventos seguem a ordem dos dias; em empate, a ordem é pagamento → compra/aporte → data-com.

- **Data-com:** gera `round2(cotas naquele momento × dividendo do mês)`, a ser pago no mês `m + defasagem`. O que cair depois do prazo aparece como "a receber após o prazo".
- **Pagamento:** o valor entra no caixa, aplicando o % de reinvestimento.
- **Compra:** usa o caixa disponível naquele dia. Uma cota comprada **antes ou no dia** da data-com tem direito ao provento do mês; comprada depois, só na data-com seguinte.
- Opção "cotas iniciais já tinham direito às datas-com anteriores ao mês 1": gera os pagamentos dos primeiros meses quando a defasagem é ≥ 1.
- Dias de 1 a 28 evitam meses curtos. Dias úteis e feriados não são modelados.

### Marcos (primeiro mês em que ocorrem)

| Marco | Regra |
| ----- | ----- |
| Primeira cota comprada só com dividendos | primeira cota integralmente paga com dinheiro de dividendos. Nas compras, o dinheiro de dividendos é usado antes do dinheiro de aportes |
| Primeira compra de 2, 5 e 10 cotas | cotas compradas no mês ≥ N (somando os fundos) |
| Dividendos superiores ao aporte mensal | dividendos recebidos > aporte mensal regular. Sem aporte mensal: "não se aplica" |
| R$ 50, R$ 100, R$ 500 e R$ 1.000 de renda mensal | dividendos recebidos no mês ≥ valor |
| Objetivos personalizados | renda mensal, total de cotas, patrimônio ou dividendos acumulados ≥ meta |

### Cenários hipotéticos

Cada cenário substitui a variação de **todos** os fundos por taxas **anuais**; as alterações pontuais são mantidas. Os valores padrão são ilustrativos e editáveis, não projeções.

| Cenário | Preço | Dividendo |
| ------- | ----- | --------- |
| Referência | constante | constante |
| Conservador | 0% a.a. | −2% a.a. |
| Moderado | +2% a.a. | +2% a.a. |
| Otimista | +4% a.a. | +4% a.a. |

Taxas anuais só passam a valer no mês 13. Em prazos de até 12 meses, os cenários coincidem com a referência.

### Exemplo validado — 96 cotas

Premissas: 96 cotas, preço R$ 10,00, dividendo R$ 0,10, sem aporte, 100% reinvestido, cotas inteiras.

| Mês | Cotas elegíveis | Dividendos | Caixa | Compra | Cotas finais | Saldo |
| --- | --------------- | ---------- | ----- | ------ | ------------ | ----- |
| 1 | 96 | 9,60 | 9,60 | 0 | 96 | 9,60 |
| 2 | 96 | 9,60 | 19,20 | 1 | 97 | 9,20 |
| 3 | 97 | 9,70 | 18,90 | 1 | 98 | 8,90 |
| 4 | 98 | 9,80 | 18,70 | 1 | 99 | 8,70 |

Em 12 meses: 108 cotas, saldo R$ 0,80 e patrimônio R$ 1.080,80. A primeira compra de 2 cotas ocorre no mês 11, com caixa de R$ 20,10.

### Limitações conhecidas

- Sem custos de corretagem/emolumentos nas compras simuladas.
- Sem impostos.
- Sem eventos corporativos.
- Sem dias úteis/feriados no calendário.
- Preços são premissas: a simulação não usa séries históricas nem gera valores aleatórios.

## Renda fixa (pós-fixados) — Parte 1

Código: `src/domain/fixed-income/` (`calendar.ts`, `taxes.ts`, `engine.ts`),
funções puras com `FinDecimal` (nunca `number` para dinheiro ou taxa).
**Todos os valores são estimativas**: o valor exato pode variar no app do banco.

### Escopo

- CDB, RDB, "caixinhas", LCI, LCA e "Outro" indexados a % do **CDI**;
  Tesouro Selic indexado à **Selic** (sem marcação a mercado; spread/ágio anual
  opcional). PREFIXADO/TESOURO_IPCA e os indexadores PRE/IPCA existem no banco
  (preparação da fase 2), mas a validação ainda não os aceita.
- LCI/LCA são isentas de IR por padrão (`taxExempt`, editável).

### Rendimento bruto (por aporte)

```
fator_dia = 1 + (taxa_dia_% / 100) × (rate / 100)            [× (1 + spread/100)^(1/252)]
valor     = aporte × Π fator_dia   (dias úteis d com data_aporte ≤ d < data_cálculo)
```

- **Convenção de datas:** rende a partir da data do aporte (inclusive) até a data
  de cálculo (exclusive). Um aporte feito hoje vale exatamente o aportado hoje e
  rende o primeiro dia amanhã — o comportamento comum de CDB de liquidez diária.
- **Dias úteis:** calendário nacional calculado em código (`calendar.ts`): fixos
  01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 25/12; 20/11 a partir de 2024
  (Lei 14.759/2023); Carnaval (segunda e terça), Sexta-feira Santa e Corpus
  Christi a partir da Páscoa. Conferido: os dias úteis de 2016 a 2026 coincidem
  exatamente com as datas publicadas na série do CDI (SGS 12).
- **Taxa ainda não publicada** (dias úteis recentes ou lacunas): usa a última
  taxa conhecida e o resultado é marcado como **projeção** (`projectedBusinessDays`,
  `ratesKnownUntil` = "índices atualizados até").
- **Sem nenhuma taxa conhecida** antes do dia: o dia não rende e é sinalizado
  (`missingBusinessDays`).

### Tributos (estimativa, por aporte)

Prazo = dias corridos da data do aporte até a data do resgate (ou da avaliação).

| Prazo | IR regressivo |
| --- | --- |
| até 180 dias | 22,5% |
| 181 a 360 dias | 20% |
| 361 a 720 dias | 17,5% |
| acima de 720 dias | 15% |

- **IOF** (Decreto 6.306/2007, tabela regressiva oficial completa): sobre o
  rendimento de resgates com menos de 30 dias (dia 1 = 96%, dia 15 = 50%,
  dia 29 = 3%, dia 30 em diante = 0%). Incide **antes** do IR: o IR é calculado
  sobre (rendimento − IOF).
- O IOF é aplicado a **todos os tipos**, inclusive LCI/LCA e Tesouro Selic —
  **estimativa conservadora** (decisão do usuário): na prática a cobrança pode
  variar por produto/emissor, e o efeito só existe nos primeiros 29 dias.
- `taxExempt = true` (LCI/LCA): sem IR.
- Rendimento ≤ 0 não gera tributo.

### Resgates: o usuário informa o LÍQUIDO RECEBIDO

O valor do resgate gravado (`fixed_income_movements.amount` com `type = WITHDRAWAL`)
é o **líquido recebido** — o que aparece no extrato do banco. O sistema calcula
o **bruto equivalente**:

1. Movimentos são processados por data; no mesmo dia, aportes antes de resgates
   (e depois a ordem de registro).
2. Os aportes ainda investidos são consumidos do **mais antigo para o mais novo
   (FIFO)** — estimativa padrão; a regra real pode variar por emissor.
3. Para cada aporte, calcula-se o que ele daria se resgatado inteiro na data:
   `bruto`, `IOF`, `IR` e `líquido = bruto − IOF − IR` (com o prazo **daquele**
   aporte).
4. Enquanto o líquido pedido for maior ou igual ao líquido do aporte, o aporte
   é consumido inteiro. No último, consome-se a fração
   `f = líquido restante ÷ líquido do aporte`; o aporte continua investido com
   `(1 − f)` do valor aplicado.
5. Bruto equivalente = soma dos brutos consumidos (`f × bruto`); idem para valor
   aplicado consumido, IOF e IR. Por construção, `bruto − IOF − IR = líquido informado`.
6. Se o líquido pedido for maior que o saldo líquido estimado, sobra um
   **excesso**. Até `max(R$ 1,00; 1% do resgate)` a diferença é atribuída à
   estimativa e o resgate é tratado como **resgate total** (o título zera).
   Acima disso, o serviço **recusa** o resgate (nada é gravado). A mesma
   conferência é feita ao editar/excluir movimentos ou mudar taxa/isenção do
   título — uma alteração que deixe algum resgate sem saldo é recusada.

Exemplo (teste `fixed-income-engine.test.ts`): R$ 1.000 em 02/01/2024 e R$ 500 em
02/01/2025, 100% do CDI com 0,04% ao dia; resgate de R$ 600 líquidos em
10/03/2025. Só o primeiro aporte é consumido (433 dias → IR 17,5%, sem IOF); o
bruto equivalente é maior que R$ 600 e o segundo aporte fica intacto.

### Saídas por título

- **Valor aplicado** (ainda investido), total aportado, total resgatado (líquido
  e bruto equivalente).
- **Bruto**, **IOF**, **IR** e **líquido** estimados "se resgatar tudo na data".
- **Rendimento no mês** = bruto_fim − bruto_início − aportes + resgates brutos.
- **Rendimento acumulado** = bruto atual + resgates brutos − aportes.
- **Evolução mês a mês**: posição no 1º dia do mês seguinte (ou na data de
  cálculo, no mês corrente), com aportes, resgates e sinalização de projeção.
  A soma dos rendimentos mensais é igual ao acumulado.

### Exportação, backup e restauração

- Exportação: conjuntos "Renda fixa" (títulos com valores estimados na data) e
  "Renda fixa — movimentos" (resgates com bruto equivalente, IOF e IR estimados),
  em CSV/Excel e no "Exportar tudo".
- Backup: inclui títulos e movimentos (`fixedIncomeAssets`, `fixedIncomeMovements`).
  As taxas do CDI/Selic não entram (são públicas e buscadas de novo).
- Restauração: os campos de renda fixa são opcionais, então backups antigos
  continuam válidos. Uma conta que já tem renda fixa conta como "com dados"
  (restauração recusada). Movimentos são gravados na ordem original de registro.

### Patrimônio total por classe de ativo (visão geral)

- Patrimônio total = FIIs (valor de mercado pela cotação atual) + renda fixa
  (valor **bruto** estimado dos títulos ativos — o saldo que os bancos mostram;
  o líquido estimado aparece ao lado). Títulos arquivados ficam fora.
- Se algum FII está sem cotação, o total fica indisponível ("—"), como antes;
  a renda fixa continua visível na divisão por classe.
- A divisão por classe vem de `src/domain/portfolio/asset-classes.ts`
  (`ASSET_CLASSES`: FIIs, Renda fixa e Ações — esta ainda sem dados). Incluir
  ações no futuro = informar o valor da classe no serviço da visão geral.
- A meta do tipo "Patrimônio" continua considerando só os FIIs (texto da meta
  deixa isso explícito).
