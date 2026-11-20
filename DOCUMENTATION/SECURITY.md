# Segurança — Bola de Neve

Revisão feita na Etapa 5 (2026-11-20). Plataforma de uso individual.

## Autenticação e sessões

- Senhas com **scrypt** (N=2¹⁵, r=8, p=1, salt de 16 bytes) e comparação em tempo constante.
- Política de senha: mínimo de 12 caracteres, com letras e números.
- Tokens de sessão aleatórios de 256 bits. O banco guarda apenas o **SHA-256** do token.
- Cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção e expiração configurável.
- Limite de tentativas de login: 5 falhas por e-mail ou 20 por IP em 15 minutos. A resposta é sempre genérica, e o tempo é o mesmo para e-mail inexistente.
- Troca de senha exige a senha atual e **encerra todas as sessões**. Em Configurações é possível encerrar as outras sessões e ver as ativas.
- Proteção de rotas em duas camadas:
  - `proxy` faz a checagem rápida do cookie;
  - a **DAL** (`requireUser`/`getCurrentUser`) valida a sessão no banco em toda página, Server Action e rota de API privada.

## Autorização e exposição de dados

- Toda consulta e alteração de dados de carteira, proventos, simulações, metas e exportações filtra pelo `userId` da sessão (verificado por varredura e por testes de isolamento entre usuários).
- Server Actions: todas chamam `requireUser()`. O Next verifica `Origin` × `Host` (CSRF).
- Rotas de API:

| Rota | Proteção |
| ---- | -------- |
| `/api/health` | pública; expõe só `ok`/`degraded`, sem versões nem erros |
| `/api/export/*`, `/api/backup` | exigem sessão; usam `Cache-Control: no-store` |
| `/api/cron/refresh` | `CRON_SECRET` comparado em tempo constante; desabilitada (404) sem o segredo |

- O backup JSON **não** contém senhas, hashes, sessões nem tentativas de login.
- A exportação CSV neutraliza fórmulas (`'` antes de `= + - @`).

## Validação no servidor

- Todo dado de formulário é validado com **Zod** no servidor, mesmo quando o cliente já validou (o editor do simulador usa o mesmo schema).
- Respostas de APIs externas também são validadas com Zod. Valores numéricos viram Decimal; ausência de dado vira `null`, nunca zero.
- Restauração de backup:
  - formato e versão conferidos;
  - checksum SHA-256;
  - limite de 7 MB;
  - aceita apenas conta sem dados;
  - tudo em uma única transação.

## Integridade do banco

- Triggers impedem `DELETE` e alteração dos dados informados de operações, proventos e recebimentos; a auditoria é somente-inserção.
- CHECKs: valores positivos, datas coerentes, motivo obrigatório ao anular, formato de CNPJ e competência.
- Índices únicos parciais impedem:
  - dois saldos iniciais ativos;
  - proventos duplicados;
  - dois recebimentos ativos para o mesmo provento;
  - leituras de cotação repetidas.
- Alterações rodam em transação, com lock da linha do fundo; o livro-razão é reprocessado e validado a cada mudança.

## Cabeçalhos HTTP

- **Content-Security-Policy** com nonce por requisição (`proxy.ts`):
  - scripts só com nonce + `'strict-dynamic'`;
  - `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src 'self'`;
  - `style-src` permite `'unsafe-inline'`, porque gráficos e componentes usam atributos `style`.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`; `X-Powered-By` removido.
- Verificado no navegador: nenhuma violação de CSP ao navegar por todas as páginas.

## Credenciais

- `.env`, `.env.test` e `/backups/` são ignorados pelo Git; só o `.env.example` (sem valores) é versionado.
- A chave da brapi é lida apenas no servidor (`server-only`) e enviada em header, nunca na URL.

## Limitações conhecidas

- O rate limit por IP depende de um proxy reverso que sobrescreva `X-Forwarded-For`.
- Não há 2FA (uso individual; recomenda-se senha longa e HTTPS).
- `style-src 'unsafe-inline'` (risco baixo; scripts permanecem restritos).
- Excluir um usuário com operações exige manutenção manual (os triggers bloqueiam a cascata — intencional).
