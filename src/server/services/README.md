# Serviços de aplicação (`src/server/services`)

Orquestram casos de uso: validam entrada (Zod), consultam/gravam no banco
(Prisma), chamam regras de negócio puras de `src/domain` e integrações de
`src/server/integrations`.

Convenções:

- Cada serviço recebe o banco por parâmetro (`db: Database`) — facilita testes.
- Toda função que lê ou grava dados recebe o `userId` do usuário autenticado
  (obtido pela DAL `src/server/auth/dal.ts`, nunca do cliente) e filtra por ele.
- Nenhum cálculo financeiro mora aqui: use `src/domain`.

Etapa 2: `portfolio/` (fundos, cotações manuais, operações e sincronização do livro-razão), `audit.ts` (trilha de auditoria) e `errors.ts` (erros de negócio com mensagem segura).
