import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DataSourceBadge, DividendStatusBadge, ReceivedBadge } from "@/components/dividends/badges";
import { PageHeader, Stat } from "@/components/portfolio/page-header";
import { CalendarDate, Money, Quantity, UnitPrice } from "@/components/portfolio/values";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toIsoDate, todayIsoDate } from "@/domain/dates";
import { FinDecimal } from "@/domain/money";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { listDividendEvents, type DividendEventView } from "@/server/services/dividends/dividend-service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendário de proventos" };

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function shift(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** Valor do evento: recebido (registrado) > esperado pela posição na data-com. */
function amountOf(e: DividendEventView) {
  return e.receipt ? e.receipt.totalAmount : e.expectedAmount;
}

function EventChip({ e }: { e: DividendEventView }) {
  const confirmed = e.kind === "OFFICIAL";
  return (
    <Link
      href={`/proventos/${e.id}`}
      className={cn(
        "block truncate rounded px-1.5 py-0.5 text-[11px] leading-tight",
        confirmed ? "bg-primary/15 text-foreground" : "border border-dashed border-muted-foreground/50 text-muted-foreground",
      )}
      title={`${e.ticker}: ${confirmed ? "confirmado" : "estimativa"}`}
    >
      {e.ticker} {confirmed ? "" : "≈"}
    </Link>
  );
}

export default async function CalendarPage({ searchParams }: PageProps<"/calendario">) {
  const user = await requireUser();
  const sp = await searchParams;
  const todayIso = todayIsoDate();
  const month = typeof sp.mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : todayIso.slice(0, 7);
  const events = (await listDividendEvents(getDb(), user.id, { todayIso })).filter((e) => e.paymentDate);
  const inMonth = events
    .filter((e) => toIsoDate(e.paymentDate!).startsWith(month))
    .sort((a, b) => a.paymentDate!.getTime() - b.paymentDate!.getTime() || a.ticker.localeCompare(b.ticker));
  const byDay = new Map<number, DividendEventView[]>();
  for (const e of inMonth) {
    const day = e.paymentDate!.getUTCDate();
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  const [y, m] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array.from({ length: firstWeekday }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];

  const sum = (list: DividendEventView[]) =>
    list.reduce((a, e) => { const v = amountOf(e); return v ? a.plus(v) : a; }, new FinDecimal(0));
  const confirmed = inMonth.filter((e) => e.kind === "OFFICIAL" && e.type === "INCOME");
  const unknownValue = (list: DividendEventView[]) => list.filter((e) => !amountOf(e)).length;
  const hintFor = (list: DividendEventView[], what: string) =>
    `${list.length} ${what}${unknownValue(list) ? ` · ${unknownValue(list)} sem valor conhecido (quantidade elegível desconhecida)` : ""}`;
  const estimates = inMonth.filter((e) => e.kind === "FORECAST");
  const upcoming = events.filter((e) => toIsoDate(e.paymentDate!) >= todayIso).sort((a, b) => a.paymentDate!.getTime() - b.paymentDate!.getTime()).slice(0, 10);
  const history = events.filter((e) => toIsoDate(e.paymentDate!) < todayIso).sort((a, b) => b.paymentDate!.getTime() - a.paymentDate!.getTime()).slice(0, 12);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Calendário de proventos"
        description="Datas de pagamento. Confirmados = anúncio oficial; estimativas = previsões suas (nunca tratadas como anúncio)."
        actions={<Button asChild variant="outline"><Link href="/proventos/novo">Registrar provento</Link></Button>}
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label={`Confirmados em ${MONTHS[m - 1].toLowerCase()}`} hint={hintFor(confirmed, "pagamento(s) de rendimento")}><Money value={sum(confirmed)} /></Stat>
        <Stat label="Estimativas no mês" hint={hintFor(estimates, "previsão(ões)")} info="Previsões cadastradas por você. Não são anúncios."><Money value={sum(estimates)} /></Stat>
        <Stat label="Recebidos e registrados no mês"><Money value={sum(inMonth.filter((e) => e.receipt))} /></Stat>
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>{MONTHS[m - 1]} de {y}</CardTitle>
          <div className="flex gap-1">
            <Button asChild variant="outline" size="icon"><Link href={`/calendario?mes=${shift(month, -1)}`} aria-label="Mês anterior"><ChevronLeft aria-hidden /></Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/calendario">Hoje</Link></Button>
            <Button asChild variant="outline" size="icon"><Link href={`/calendario?mes=${shift(month, 1)}`} aria-label="Próximo mês"><ChevronRight aria-hidden /></Link></Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="hidden grid-cols-7 gap-1 sm:grid" role="grid" aria-label={`Calendário de ${MONTHS[m - 1]}`}>
            {WEEKDAYS.map((w) => <div key={w} className="px-1 text-xs font-medium text-muted-foreground">{w}</div>)}
            {cells.map((day, i) => {
              const iso = day ? `${month}-${String(day).padStart(2, "0")}` : "";
              return (
                <div key={i} className={cn("min-h-20 rounded-md border p-1", !day && "border-transparent", iso === todayIso && "border-primary")}>
                  {day ? (
                    <>
                      <div className="text-xs text-muted-foreground">{day}</div>
                      <div className="mt-1 grid gap-0.5">{(byDay.get(day) ?? []).map((e) => <EventChip key={e.id} e={e} />)}</div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
          <ul className="grid gap-2" data-testid="calendar-month-list">
            {inMonth.length === 0 ? <li className="text-sm text-muted-foreground">Nenhum pagamento neste mês.</li> : null}
            {inMonth.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <strong>{e.ticker}</strong>
                  <CalendarDate value={e.paymentDate} /> · <UnitPrice value={e.ratePerShare} />/cota
                  {e.eligibility.status === "KNOWN" && e.eligibility.quantity.gt(0) ? <> × <Quantity value={e.eligibility.quantity} /></> : null}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Money value={amountOf(e)} />
                  <DividendStatusBadge status={e.status} />
                  {e.receipt ? <ReceivedBadge /> : null}
                  <DataSourceBadge source={e.source} verified={e.verified} />
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Próximos pagamentos</CardTitle><CardDescription>Anunciados e estimativas com data futura.</CardDescription></CardHeader>
          <CardContent>
            {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Aguardando divulgação.</p> : (
              <ul className="grid gap-2 text-sm">
                {upcoming.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
                    <span><strong>{e.ticker}</strong> · <CalendarDate value={e.paymentDate} /> · <UnitPrice value={e.ratePerShare} /></span>
                    <span className="flex items-center gap-2"><Money value={e.expectedAmount} /><DividendStatusBadge status={e.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Histórico recente</CardTitle><CardDescription><Link className="underline" href="/proventos">Histórico completo</Link></CardDescription></CardHeader>
          <CardContent>
            {history.length === 0 ? <p className="text-sm text-muted-foreground">Sem pagamentos anteriores registrados.</p> : (
              <ul className="grid gap-2 text-sm">
                {history.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
                    <span><strong>{e.ticker}</strong> · <CalendarDate value={e.paymentDate} /> · <UnitPrice value={e.ratePerShare} /></span>
                    <span className="flex items-center gap-2"><Money value={amountOf(e)} />{e.receipt ? <ReceivedBadge /> : <DividendStatusBadge status={e.status} />}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
