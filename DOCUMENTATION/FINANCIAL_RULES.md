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
| Proventos recebidos | 📋 Definida, não implementada | — | — |
| Indicadores (DY, YoC) | 📋 Definida, não implementada | — | — |
| Eventos corporativos (desdobramento, grupamento, amortização) | ⏳ A definir | — | — |
| Simulador de reinvestimento | ⏳ A definir na etapa do simulador | — | — |
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

## Definições ainda não implementadas

### Proventos

- O direito ao provento é de quem detém a cota ao final da **data com**; o
  pagamento ocorre na **data de pagamento**. Ambas as datas serão armazenadas.
- `provento_recebido = quantidade_na_data_com × valor_por_cota`, arredondado a
  2 casas apenas no valor total. A quantidade na data com virá do ledger.

### Indicadores

- **Dividend Yield (DY) de N meses** = soma dos proventos por cota pagos nos
  últimos N meses ÷ cotação de referência. A janela (N) e a data da cotação
  devem sempre ser exibidas junto ao número.
- **Yield on Cost (YoC)** = proventos por cota no período ÷ preço médio.

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

## Simulador de reinvestimento

Premissas (taxa de reinvestimento, crescimento de proventos, aportes, preço de
compra) serão sempre **parâmetros informados pelo usuário** e exibidos junto ao
resultado, deixando claro que se trata de projeção e não de promessa de
rentabilidade. Regras detalhadas serão definidas na etapa do simulador.
