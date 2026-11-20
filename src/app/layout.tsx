import type { Metadata } from "next";
import "./globals.css";

/**
 * Todas as páginas são renderizadas por requisição: necessário para o nonce
 * da Content-Security-Policy (src/proxy.ts) e coerente com dados por usuário.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Bola de Neve",
    template: "%s · Bola de Neve",
  },
  description: "Gestão privada de investimentos em Fundos Imobiliários.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="dark h-full antialiased" style={{ colorScheme: "dark" }}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
