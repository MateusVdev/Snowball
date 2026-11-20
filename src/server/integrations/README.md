# Integrações externas (`src/server/integrations`)

Clientes de APIs externas (cotações, proventos, indicadores). Uma pasta por
provedor, expondo uma interface comum para que a fonte possa ser trocada.

Convenções:

- Toda resposta externa é validada com Zod antes de ser usada.
- Valores numéricos são convertidos para Decimal (`src/domain/money.ts`) —
  nunca `number` em cálculos.
- Guardar a origem (`source`) e a data da informação junto ao dado persistido.
- Falha de integração nunca deve gerar valor inventado: retornar erro/ausência.
- Chaves de API apenas via variáveis de ambiente (documentar em `.env.example`).

Vazio nesta etapa (Etapa 1 — fundação). Nenhuma API financeira implementada.
