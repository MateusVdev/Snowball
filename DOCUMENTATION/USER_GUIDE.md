# Guia de uso — Bola de Neve

## Primeiros passos

1. **Minha carteira → Adicionar FII.**
   - Informe o ticker.
   - Se você já tem cotas, marque "Informar saldo inicial" (quantidade e preço médio, sem data).
   - Informe uma cotação de referência, se quiser.
2. **Movimentações → Registrar operação** para compras e vendas, com data, quantidade, preço e taxas.
3. **Dividendos** para os proventos:
   - **Importar proventos agora** busca na brapi e, para fundos com CNPJ, nos avisos oficiais da B3;
   - ou registre manualmente.
4. **Simulador bola de neve** para projetar o reinvestimento.

## Seções

| Seção | Para que serve |
| ----- | -------------- |
| Visão geral | Patrimônio, investido, resultado, rentabilidade, cotas, dividendos (mês, ano, acumulado, média), renda recorrente estimada, metas, evolução patrimonial, dividendos, aportes e distribuição |
| Minha carteira | Posições, cotações (manual/automática), pesquisa por ticker, atualização de cotações |
| Análise da carteira | Pesos por fundo e segmento, resultados, DY, yield on cost e renda por fundo |
| Movimentações | Histórico filtrável. Corrigir e cancelar exigem motivo; nada é apagado |
| Dividendos | Próximos pagamentos ("Aguardando divulgação." quando não há anúncio), pendências, histórico mensal/anual, DY |
| Análise individual | Cartões por fundo → página com cotação, histórico de preços, último e próximo provento, preço médio, posição e resultado |
| Simulador | Premissas, fundos (inclusive da carteira), cenários, estratégias, marcos, tabela mensal e gráficos. Destaque das cotas compradas só com dividendos |
| Metas | Renda mensal, patrimônio, cotas ou objetivo personalizado. Progresso, valor restante e prazo estimado por uma simulação |
| Calendário | Pagamentos por dia: confirmados (anúncio oficial) e estimativas (previsões suas) |
| Central de dados | Origem dos dados, integrações, histórico de atualizações, exportação CSV/Excel, backup e restauração |
| Configurações | Nome, troca de senha, sessões ativas e atualização automática |

## Como ler os valores

- **Cotação "Manual"** = valor de referência digitado. **"Automática · brapi"** = cotação da API. **"Fechamento · brapi"** = último fechamento diário (quando o plano não libera a cotação atual). **"Desatualizada"** = mais antiga que o limite configurado.
- **Rentabilidade** = resultado não realizado ÷ capital investido. Não inclui proventos.
- **Renda recorrente estimada** = cotas atuais × último rendimento oficial pago. É estimativa, não garantia.
- **Elegibilidade a proventos:**
  - é calculada pelo histórico na data-com;
  - o saldo inicial (sem data) só conta a partir do dia em que foi registrado;
  - antes disso, informe a quantidade ao registrar o recebimento.
- **Simulações** são sempre hipotéticas e nunca alteram a carteira real.

## Boas práticas

- Baixe o backup (Central de dados) periodicamente; no servidor, agende `npm run db:backup`.
- Cadastre o CNPJ de cada fundo (ou aplique a sugestão em "Consultar dados cadastrais") para importar os avisos oficiais da B3.
- Confira divergências reportadas na importação de proventos. Nada é sobrescrito automaticamente.
