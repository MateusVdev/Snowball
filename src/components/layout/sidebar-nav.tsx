"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";

function isActive(pathname: string, href: string, match: string[] = []) {
  return [href, ...match].some((h) => pathname === h || pathname.startsWith(`${h}/`));
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal" className="grid gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon, match }) => {
        const active = isActive(pathname, href, match);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon aria-hidden className={cn("size-4 shrink-0", active ? "text-sidebar-primary" : "opacity-80")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Menu lateral fixo (≥ lg) e gaveta acionada por botão (telas menores).
 * Fica FORA do cabeçalho: o backdrop-filter do cabeçalho criaria um bloco de
 * contenção para elementos `fixed`.
 */
export function SidebarNav() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="fixed left-4 top-2.5 z-30 inline-flex size-9 items-center justify-center rounded-md border bg-background lg:hidden"
        aria-label="Abrir menu"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen(true)}
      >
        <Menu aria-hidden className="size-5" />
      </button>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 lg:flex">
        <Brand />
        <div className="mt-6 flex-1 overflow-y-auto"><NavList /></div>
        <p className="px-3 text-[11px] text-sidebar-foreground/50">Simulações são hipotéticas. Dados de mercado podem ter atraso.</p>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" id="mobile-nav" aria-label="Menu">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-black/60 animate-in fade-in" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar px-3 py-5 shadow-2xl animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between">
              <Brand />
              <button type="button" className="inline-flex size-9 items-center justify-center rounded-md" aria-label="Fechar menu" onClick={() => setOpen(false)}>
                <X aria-hidden className="size-5" />
              </button>
            </div>
            <div className="mt-6 flex-1 overflow-y-auto"><NavList onNavigate={() => setOpen(false)} /></div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-2">
      <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.55_0.2_300)] text-primary-foreground shadow-lg shadow-primary/20">
        <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="13" r="7" /><circle cx="12" cy="13" r="3" /><path d="M12 2v4" /></svg>
      </span>
      <span className="leading-tight">
        <span className="block text-base font-semibold text-sidebar-accent-foreground">Bola de Neve</span>
        <span className="block text-[11px] text-sidebar-foreground/60">Carteira de FIIs</span>
      </span>
    </Link>
  );
}
