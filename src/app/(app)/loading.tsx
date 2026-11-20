/** Estado de carregamento das páginas privadas (esqueleto discreto). */
export default function Loading() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl border bg-card" />
    </div>
  );
}
