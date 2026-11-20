/**
 * Cadastra a carteira inicial informada pelo usuário (idempotente):
 *
 *   npm run portfolio:seed -- --email voce@exemplo.com
 *
 * - MXRF11: 31 cotas, preço médio R$ 8,44, cotação manual R$ 8,52
 * - HGLG11:  1 cota,  preço médio R$ 145,00, cotação manual R$ 141,80
 *
 * As posições entram como SALDO INICIAL (sem data e sem operações de compra
 * inventadas). As cotações são registradas como MANUAIS, de referência.
 * Nome e segmento dos fundos ficam em branco: não foram informados e podem
 * ser preenchidos pela interface.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { createPrismaClient } from "@/server/db/factory";
import { createFund } from "@/server/services/portfolio/fund-service";
import { emailSchema } from "@/validation/auth";

const INITIAL_PORTFOLIO = [
  { ticker: "MXRF11", quantity: "31", averagePrice: "8.44", quote: "8.52" },
  { ticker: "HGLG11", quantity: "1", averagePrice: "145.00", quote: "141.80" },
] as const;

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" } } });
  const email = emailSchema.parse(values.email);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const db = createPrismaClient(url);

  try {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) throw new Error(`Usuário ${email} não encontrado. Crie-o com npm run user:create.`);

    for (const item of INITIAL_PORTFOLIO) {
      const exists = await db.fund.findUnique({
        where: { userId_ticker: { userId: user.id, ticker: item.ticker } },
      });
      if (exists) {
        console.log(`• ${item.ticker} já cadastrado — mantido sem alterações.`);
        continue;
      }
      await createFund(
        db,
        user.id,
        { ticker: item.ticker },
        {
          initialBalance: {
            quantity: item.quantity,
            averagePrice: item.averagePrice,
            notes: "Saldo inicial informado pelo usuário (data de aquisição não informada).",
          },
          quote: {
            price: item.quote,
            note: "Cotação inicial manual de referência.",
          },
        },
      );
      console.log(
        `✔ ${item.ticker}: ${item.quantity} cota(s), PM R$ ${item.averagePrice}, cotação manual R$ ${item.quote}`,
      );
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
