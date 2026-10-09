import { useEffect, useState, type FormEvent } from "react";
import { PushNotices } from "@/components/painel/push";
import {
  cancelPanelBooking,
  createPanelBlock,
  fetchAgenda,
  removePanelBlock,
  submitPanelLogout,
} from "@/lib/painel/painel.functions";

type View = "today" | "week";

type BookingCard = {
  id: string;
  customerName: string;
  phoneLabel: string;
  waUrl: string | null;
  serviceName: string;
  barberName: string;
  startLabel: string;
  endLabel: string;
  status: "active" | "cancelled";
};

type BlockCard = {
  id: string;
  barberName: string;
  allDay: boolean;
  startLabel: string;
  endLabel: string;
  reason: string | null;
};

type Day = {
  iso: string;
  label: string;
  bookings: BookingCard[];
  blocks: BlockCard[];
};

type Barber = { id: string; name: string };

export function PanelAgenda() {
  const [view, setView] = useState<View>("today");
  const [barberId, setBarberId] = useState("");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [shopName, setShopName] = useState("Painel");
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    void fetchAgenda({
      data: { view, barberId: barberId || null, includeCancelled },
    })
      .then((result) => {
        if (cancel) return;
        if (!result.ok) {
          window.location.assign("/painel/entrar");
          return;
        }
        setShopName(result.data.shopName);
        setBarbers(result.data.barbers);
        setDays(result.data.days);
      })
      .catch(() => {
        if (!cancel) setError("Não foi possível carregar a agenda.");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [view, barberId, includeCancelled, refresh]);

  async function logout() {
    await submitPanelLogout();
    window.location.assign("/painel/entrar");
  }

  async function cancelBooking(id: string) {
    const result = await cancelPanelBooking({ data: { id } });
    if (!result.ok) {
      setError("Não foi possível cancelar.");
      setConfirmId(null);
      return;
    }
    setConfirmId(null);
    setRefresh((value) => value + 1);
  }

  async function removeBlock(id: string) {
    const result = await removePanelBlock({ data: { id } });
    if (!result.ok) {
      setError("Não foi possível remover o bloqueio.");
      return;
    }
    setRefresh((value) => value + 1);
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col overflow-x-hidden">
      <header className="flex items-center justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-widest text-gold uppercase">Painel</p>
          <h1 className="truncate font-display text-3xl leading-none uppercase">{shopName}</h1>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="min-h-12 shrink-0 border border-line px-4 text-sm tracking-wide text-cream uppercase"
        >
          Sair
        </button>
      </header>

      <div className="grid gap-3 px-5 pt-5">
        <label className="block">
          <span className="text-xs tracking-widest text-mist uppercase">Barbeiro</span>
          <select
            value={barberId}
            onChange={(event) => setBarberId(event.target.value)}
            className="mt-1 min-h-12 w-full min-w-0 max-w-full border border-line bg-panel-2 px-3 text-cream"
          >
            <option value="">Todos</option>
            {barbers.map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-pressed={includeCancelled}
          onClick={() => setIncludeCancelled((value) => !value)}
          className="min-h-12 w-full border border-line px-4 text-left text-sm text-cream"
        >
          {includeCancelled ? "Ocultar cancelados" : "Mostrar cancelados"}
        </button>
        <PushNotices />
      </div>

      <div className="flex-1 px-5 pt-6 pb-36">
        {loading && <p className="text-mist">Carregando a agenda…</p>}
        {error && <p className="mb-3 text-sm text-gold">{error}</p>}
        {!loading &&
          days.map((day) => (
            <section key={day.iso} className="mb-6">
              <h2 className="font-display text-2xl tracking-wide uppercase">{day.label}</h2>
              {day.blocks.map((block) => (
                <article key={block.id} className="mt-3 border border-line bg-panel-2 p-4">
                  <p className="text-xs tracking-widest text-gold uppercase">Bloqueio</p>
                  <p className="mt-1 font-display text-2xl uppercase">{block.barberName}</p>
                  <p className="mt-1 text-sm text-mist">
                    {block.allDay ? "Dia inteiro" : `${block.startLabel}–${block.endLabel}`}
                  </p>
                  {block.reason && <p className="mt-1 text-sm text-cream">{block.reason}</p>}
                  <button
                    type="button"
                    onClick={() => void removeBlock(block.id)}
                    className="mt-3 min-h-12 w-full border border-line text-sm tracking-wide uppercase"
                  >
                    Remover bloqueio
                  </button>
                </article>
              ))}
              {day.bookings.map((booking) => (
                <article key={booking.id} className="mt-3 border border-line p-4">
                  <p className="text-xs tracking-widest text-mist uppercase">
                    {booking.startLabel}–{booking.endLabel}
                    {booking.status === "cancelled" ? " · Cancelado" : ""}
                  </p>
                  <p className={`mt-1 font-display text-3xl leading-none uppercase ${booking.status === "cancelled" ? "text-mist line-through" : ""}`}>
                    {booking.customerName}
                  </p>
                  <p className="mt-2 text-sm text-cream">{booking.phoneLabel}</p>
                  <p className="text-sm text-mist">
                    {booking.serviceName} · {booking.barberName}
                  </p>
                  <div className="mt-4 grid gap-2">
                    {booking.waUrl && (
                      <a
                        href={booking.waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-12 items-center justify-center border border-gold px-3 text-center font-display text-lg tracking-wide text-gold uppercase"
                      >
                        Chamar no WhatsApp
                      </a>
                    )}
                    {booking.status === "active" && confirmId !== booking.id && (
                      <button
                        type="button"
                        onClick={() => setConfirmId(booking.id)}
                        className="min-h-12 w-full border border-line text-sm tracking-wide uppercase"
                      >
                        Cancelar
                      </button>
                    )}
                    {confirmId === booking.id && (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => void cancelBooking(booking.id)}
                          className="min-h-12 bg-gold px-2 font-display text-lg tracking-wide text-ink uppercase"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="min-h-12 border border-line text-sm uppercase"
                        >
                          Voltar
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {day.bookings.length === 0 && day.blocks.length === 0 && (
                <p className="mt-2 text-sm text-mist">Nenhum horário neste dia.</p>
              )}
            </section>
          ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-ink px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setView("today")}
            className={`min-h-12 text-sm tracking-wide uppercase ${view === "today" ? "bg-gold text-ink" : "border border-line text-cream"}`}
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => setView("week")}
            className={`min-h-12 text-sm tracking-wide uppercase ${view === "week" ? "bg-gold text-ink" : "border border-line text-cream"}`}
          >
            Semana
          </button>
          <button
            type="button"
            onClick={() => setBlocking(true)}
            className="min-h-12 border border-gold text-sm tracking-wide text-gold uppercase"
          >
            Bloquear
          </button>
        </div>
      </div>

      {blocking && (
        <BlockSheet
          barbers={barbers}
          onClose={() => setBlocking(false)}
          onSaved={() => {
            setBlocking(false);
            setRefresh((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}

function BlockSheet({
  barbers,
  onClose,
  onSaved,
}: {
  barbers: Barber[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [barberId, setBarberId] = useState(barbers[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await createPanelBlock({
        data: { barberId, date, allDay, start, end, reason },
      });
      if (!result.ok) {
        setError("message" in result && result.message ? result.message : "Não foi possível bloquear.");
        setPending(false);
        return;
      }
      onSaved();
    } catch {
      setError("Não foi possível bloquear.");
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end bg-ink/80">
      <form onSubmit={(event) => void save(event)} className="max-h-[90dvh] overflow-y-auto border-t border-line bg-panel px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <h2 className="font-display text-3xl uppercase">Bloquear horário</h2>
        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className="text-xs tracking-widest text-mist uppercase">Barbeiro</span>
            <select
              required
              value={barberId}
              onChange={(event) => setBarberId(event.target.value)}
              className="mt-1 min-h-12 w-full min-w-0 max-w-full border border-line bg-panel-2 px-3 text-cream"
            >
              {barbers.map((barber) => (
                <option key={barber.id} value={barber.id}>
                  {barber.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs tracking-widest text-mist uppercase">Dia</span>
            <input
              required
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="mt-1 min-h-12 w-full min-w-0 max-w-full border border-line bg-panel-2 px-3 text-cream"
            />
          </label>
          <button
            type="button"
            aria-pressed={allDay}
            onClick={() => setAllDay((value) => !value)}
            className={`min-h-12 w-full border px-3 text-sm uppercase ${allDay ? "border-gold text-gold" : "border-line text-cream"}`}
          >
            Dia inteiro
          </button>
          {!allDay && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs tracking-widest text-mist uppercase">Início</span>
                <input
                  required
                  type="time"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  className="mt-1 min-h-12 w-full min-w-0 max-w-full border border-line bg-panel-2 px-3 text-cream"
                />
              </label>
              <label className="block">
                <span className="text-xs tracking-widest text-mist uppercase">Fim</span>
                <input
                  required
                  type="time"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  className="mt-1 min-h-12 w-full min-w-0 max-w-full border border-line bg-panel-2 px-3 text-cream"
                />
              </label>
            </div>
          )}
          <label className="block">
            <span className="text-xs tracking-widest text-mist uppercase">Motivo (opcional)</span>
            <input
              value={reason}
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 min-h-12 w-full min-w-0 max-w-full border border-line bg-panel-2 px-3 text-cream"
            />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-gold">{error}</p>}
        <div className="mt-4 grid gap-2">
          <button
            type="submit"
            disabled={pending}
            className="min-h-12 w-full bg-gold font-display text-xl tracking-widest text-ink uppercase disabled:opacity-70"
          >
            {pending ? "Salvando…" : "Salvar bloqueio"}
          </button>
          <button type="button" onClick={onClose} className="min-h-12 w-full text-sm tracking-wide text-mist uppercase">
            Fechar
          </button>
        </div>
      </form>
    </div>
  );
}
