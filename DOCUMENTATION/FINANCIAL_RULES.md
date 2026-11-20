# Regras Financeiras — Bola de Neve

Este documento é a referência para **todo** cálculo financeiro da plataforma.
Cada regra implementada deve apontar para o módulo em `src/domain` que a
implementa e para os testes que a verificam.

> **Princípio:** a plataforma nunca inventa informação financeira. Preços,
> proventos, datas e indicadores vêm do usuário ou de fontes externas
> identificadas. Na ausência de dado, exibe-se "indisponível" — nunca uma
> estimativa silenciosa.

## Status das regras

| Regra | Status | Módulo |
| ----- | ------ | ------ |
| Representação numérica e arredondamento | ✅ Implementada (Etapa 1) | `src/domain/money.ts` |
| Formatação em reais | ✅ Implementada (Etapa 1) | `src/domain/money.ts` |
| Preço médio | 📋 Definida, não implementada | — |
| Posição e custo total | 📋 Definida, não implementada | — |
| Proventos recebidos | 📋 Definida, não implementada | — |
| Indicadores (DY, YoC) | 📋 Definida, não implementada | — |
| Simulador de reinvestimento | ⏳ A definir na etapa do simulador | — |
| Tributação | ⚠️ A pesquisar e validar em fonte oficial antes de implementar | — |

## Precisão e arredondamento

1. **Nunca usar `number` (ponto flutuante) em cálculos financeiros.** Toda
   entrada é convertida para `FinDecimal` (`toDecimal`) — preferencialmente a
   partir de `string`.
2. Cálculos intermediários mantêm precisão total (40 dígitos significativos).
3. Arredondamento **apenas** na persistência e na apresentação, com
   **arredondamento comercial (half-up)**: `roundTo`, `roundMoney`.
4. Valores do Prisma (`Prisma.Decimal`) são convertidos com
   `toDecimal(valor.toString())`.

### Escalas (casas decimais)

Constante `SCALE` em `src/domain/money.ts`; colunas do banco devem usar o
`NUMERIC` correspondente:

| Grandeza | Escala | Coluna sugerida | Exemplos |
| -------- | ------ | --------------- | -------- |
| Valor em reais (totais, custos, proventos recebidos) | 2 | `@db.Decimal(18, 2)` | total de uma compra, provento creditado |
| Preço unitário / provento por cota | 8 | `@db.Decimal(18, 8)` | cotação, rendimento por cota, preço médio |
| Quantidade de cotas | 8 | `@db.Decimal(18, 8)` | normalmente inteira; escala reservada para eventos corporativos |
| Taxas e percentuais (fração) | 10 | `@db.Decimal(18, 10)` | 0,0085 = 0,85% |

## Definições (a implementar nas próximas etapas)

As fórmulas abaixo são convenções de cálculo da plataforma. Qualquer alteração
deve ser registrada aqui antes de ir para o código.

### Preço médio (custo médio ponderado)

- **Compra:** `novo_PM = (qtd_atual × PM_atual + qtd_comprada × preço + custos_da_operação) / (qtd_atual + qtd_comprada)`
- **Venda:** a quantidade diminui; o preço médio **não muda**.
- Se a posição zerar, o preço médio é reiniciado na próxima compra.
- Custos da operação (corretagem, emolumentos etc.) compõem o custo de aquisição
  quando informados pelo usuário.
- Eventos corporativos (desdobramento, grupamento, amortização) exigirão regra
  específica — a definir.

### Posição

- `custo_total = quantidade × preço_médio`
- `valor_de_mercado = quantidade × última_cotação` (somente com cotação de fonte
  identificada e com data; caso contrário, "indisponível").
- `resultado_não_realizado = valor_de_mercado − custo_total`

### Proventos

- O direito ao provento é de quem detém a cota ao final da **data com**; o
  pagamento ocorre na **data de pagamento**. Ambas as datas são armazenadas.
- `provento_recebido = quantidade_na_data_com × valor_por_cota`, arredondado a
  2 casas apenas no valor total.

### Indicadores

- **Dividend Yield (DY) de N meses** = soma dos proventos por cota pagos nos
  últimos N meses ÷ cotação de referência. A janela (N) e a data da cotação
  devem sempre ser exibidas junto ao número.
- **Yield on Cost (YoC)** = proventos por cota no período ÷ preço médio.

## Tributação

Regras tributárias (isenção de rendimentos para pessoa física, imposto sobre
ganho de capital na venda de cotas, DARF, compensação de prejuízos) **não são
implementadas nesta fase** e mudam com a legislação. Antes de implementar,
cada regra deve ser validada em fonte oficial (Receita Federal / legislação
vigente), com a referência registrada neste documento.

## Simulador de reinvestimento

Premissas (taxa de reinvestimento, crescimento de proventos, aportes, preço de
compra) serão sempre **parâmetros informados pelo usuário** e exibidos junto ao
resultado, deixando claro que se trata de projeção e não de promessa de
rentabilidade. Regras detalhadas serão definidas na etapa do simulador.
