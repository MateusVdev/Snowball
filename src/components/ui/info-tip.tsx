"use client";

import { Tooltip as T } from "radix-ui";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

/** Ícone de ajuda com explicação (tooltip acessível por teclado e toque). */
export function InfoTip({ children, label = "Mais informações" }: { children: ReactNode; label?: string }) {
  return (
    <T.Provider delayDuration={150}>
      <T.Root>
        <T.Trigger asChild>
          <button type="button" aria-label={label} className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2">
            <Info aria-hidden className="size-3.5" />
          </button>
        </T.Trigger>
        <T.Portal>
          <T.Content sideOffset={6} className="z-50 max-w-xs rounded-md border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-lg animate-in fade-in zoom-in-95">
            {children}
            <T.Arrow className="fill-popover" />
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
