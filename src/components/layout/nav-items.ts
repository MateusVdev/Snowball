import {
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  Coins,
  Database,
  Gauge,
  Landmark,
  Search,
  Settings,
  Snowflake,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Navegação principal (menu lateral). Cada item leva a uma página funcional. */
export const NAV_ITEMS: { href: string; label: string; icon: LucideIcon; match?: string[] }[] = [
  { href: "/dashboard", label: "Visão geral", icon: Gauge },
  { href: "/carteira", label: "Minha carteira", icon: Wallet },
  { href: "/renda-fixa", label: "Renda fixa", icon: Landmark },
  { href: "/analise", label: "Análise da carteira", icon: BarChart3 },
  { href: "/operacoes", label: "Movimentações", icon: ArrowLeftRight },
  { href: "/proventos", label: "Dividendos", icon: Coins },
  { href: "/fundos", label: "Análise individual", icon: Search },
  { href: "/simulador", label: "Simulador bola de neve", icon: Snowflake },
  { href: "/metas", label: "Metas financeiras", icon: Target },
  { href: "/calendario", label: "Calendário de proventos", icon: CalendarDays },
  { href: "/dados", label: "Central de dados", icon: Database, match: ["/integracoes"] },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];
