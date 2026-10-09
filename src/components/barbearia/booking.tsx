import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronLeft, UserRound } from "lucide-react";
import { ANY_BARBER, shop } from "@/shop-config";
import {
  MONTHS_SHORT,
  WEEKDAYS_SHORT,
  barberName,
  brl,
  dateLabel,
  isPastSlot,
  isSlotTaken,
  slotsFor,
  upcomingDays,
  waLink,
  weekdayFromIso,
  type DayCell,
} from "@/lib/schedule";

const STEPS = ["Serviço", "Barbeiro", "Dia", "Horário", "Dados"] as const;

export type BookingState = {
  step: 1 | 2 | 3 | 4 | 5;
  serviceId: string | null;
  barberId: string | null;
  date: string | null;
  time: string | null;
  name: string;
  phone: string;
};

export const initialBooking: BookingState = {
  step: 1,
  serviceId: null,
  barberId: null,
  date: null,
  time: null,
  name: "",
  phone: "",
};

function scrollToBooking() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("agendar")?.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  });
}

export function Booking({
  state,
  setState,
}: {
  state: BookingState;
  setState: Dispatch<SetStateAction<BookingState>>;
}) {
  const [mounted, setMounted] = useState(false);
  const [askAgain, setAskAgain] = useState(false);
  const skipScroll = useRef(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (skipScroll.current) {
      skipScroll.current = false;
      return;
    }
    scrollToBooking();
  }, [state.step]);

  const days = useMemo(() => (mounted ? upcomingDays(14) : []), [mounted]);
  const service = shop.services.find((s) => s.id === state.serviceId) ?? null;
  const day = days.find((d) => d.iso === state.date) ?? null;
  const duration = service?.duration ?? shop.slotMinutes;

  useEffect(() => {
    if (!service || !state.date || !state.time) return;
    const fits = slotsFor(weekdayFromIso(state.date), service.duration).includes(state.time);
    const past = isPastSlot(state.date, state.time);
    if (fits && !past) return;
    if (!fits) setAskAgain(true);
    setState((s) => (s.time ? { ...s, time: null, step: s.step > 4 ? 4 : s.step } : s));
  }, [service, state.date, state.time, setState]);

  const slotRows = useMemo(() => {
    if (!day || !state.barberId) return [];
    return slotsFor(day.weekday, duration)
      .filter((time) => !isPastSlot(day.iso, time))
      .map((time) => ({
        time,
        taken: isSlotTaken(state.barberId ?? ANY_BARBER, day.iso, time),
      }));
  }, [day, state.barberId, duration]);

  const dayHasLaterSlot = day
    ? slotsFor(day.weekday).some((time) => !isPastSlot(day.iso, time))
    : false;

  function go(step: BookingState["step"]) {
    setState((s) => ({ ...s, step }));
  }

  function reachable(step: number) {
    if (step <= 1) return true;
    if (!service) return false;
    if (step === 2) return true;
    if (!state.barberId) return false;
    if (step === 3) return true;
    if (!day || day.closed) return false;
    if (step === 4) return true;
    if (!state.time) return false;
    const stillTaken = isSlotTaken(state.barberId ?? ANY_BARBER, day.iso, state.time);
    const past = isPastSlot(day.iso, state.time);
    return !stillTaken && !past;
  }

  const message =
    service && day && state.time
      ? [
          "Olá! Gostaria de agendar:",
          `Serviço: ${service.name} (R$ ${service.price})`,
          `Barbeiro: ${barberName(state.barberId)}`,
          `Data: ${dateLabel(day)}`,
          `Horário: ${state.time}`,
          `Nome: ${state.name.trim()}`,
          ...(state.phone.trim() ? [`Telefone: ${state.phone.trim()}`] : []),
        ].join("\n")
      : "";

  const nameOk = state.name.trim().length >= 2;
  const confirmHref = message && nameOk ? waLink(message) : undefined;

  return (
    <section id="agendar" className="scroll-mt-20 border-t border-line bg-panel">
      <div className="mx-auto max-w-3xl px-5 py-16 md:py-24">
        <p className="text-xs font-medium tracking-widest text-gold uppercase">Agenda</p>
        <h2 className="mt-2 font-display text-5xl leading-none uppercase md:text-6xl">
          Agende seu horário
        </h2>
        <p className="mt-4 max-w-xl text-pretty text-mist">
          Escolha o serviço, o barbeiro e o horário. A confirmação chega direto no WhatsApp da casa.
        </p>

        <div className="mt-8" aria-label="Etapas do agendamento">
          <div className="flex gap-1.5">
            {STEPS.map((label, i) => {
              const n = (i + 1) as BookingState["step"];
              const on = n <= state.step;
              const open = reachable(n);
              return (
                <button
                  key={label}
                  type="button"
                  disabled={!open}
                  aria-current={n === state.step ? "step" : undefined}
                  aria-label={`${label}${open ? "" : ", bloqueado"}`}
                  onClick={() => open && go(n)}
                  className={`h-1.5 flex-1 ${on ? "bg-gold" : "bg-line"} disabled:cursor-not-allowed`}
                />
              );
            })}
          </div>
          <p className="mt-3 font-display text-xl tracking-wide text-cream uppercase">
            <span className="text-gold">{String(state.step).padStart(2, "0")}</span>
            <span className="text-mist"> / 05</span>
            <span className="ml-3">{STEPS[state.step - 1]}</span>
          </p>
        </div>

        {service && state.step > 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            className="mt-6 flex w-full items-center justify-between border border-line bg-ink px-4 py-3 text-left"
          >
            <span>
              <span className="block text-xs tracking-widest text-mist uppercase">Selecionado</span>
              <span className="font-display text-2xl tracking-wide uppercase">{service.name}</span>
            </span>
            <span className="text-right">
              <span className="block font-display text-2xl text-gold tabular-nums">{brl(service.price)}</span>
              <span className="text-xs text-mist">{service.duration} min</span>
            </span>
          </button>
        )}

        <div key={state.step} className="step-in mt-6">
          {state.step === 1 && (
            <ul className="divide-y divide-line border-y border-line">
              {shop.services.map((item) => {
                const selected = item.id === state.serviceId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setState((s) => ({ ...s, serviceId: item.id, step: 2 }))}
                      className={`flex w-full items-start gap-4 py-4 text-left ${selected ? "text-cream" : ""}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-3xl tracking-wide uppercase">{item.name}</span>
                        <span className="mt-1 block text-sm text-pretty text-mist">{item.description}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-display text-2xl text-gold tabular-nums">{brl(item.price)}</span>
                        <span className="text-xs tracking-wide text-mist uppercase">{item.duration} min</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {state.step === 2 && (
            <div>
              <Back onClick={() => go(1)} />
              <button
                type="button"
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    barberId: ANY_BARBER,
                    time: null,
                    step: 3,
                  }))
                }
                className={`mt-4 flex min-h-16 w-full items-center gap-3 border px-4 text-left ${
                  state.barberId === ANY_BARBER ? "border-gold" : "border-line bg-ink"
                }`}
              >
                <UserRound className="size-6 shrink-0 text-gold" aria-hidden="true" />
                <span>
                  <span className="block font-display text-2xl leading-none tracking-wide uppercase">
                    Sem preferência
                  </span>
                  <span className="mt-1 block text-sm text-mist">Qualquer barbeiro disponível</span>
                </span>
              </button>
              <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
                {shop.barbers.map((barber) => {
                  const selected = state.barberId === barber.id;
                  return (
                    <button
                      key={barber.id}
                      type="button"
                      onClick={() =>
                        setState((s) => ({
                          ...s,
                          barberId: barber.id,
                          time: null,
                          step: 3,
                        }))
                      }
                      className={`w-40 shrink-0 overflow-hidden border text-left ${selected ? "border-gold" : "border-line"}`}
                    >
                      <img src={barber.photo} alt="" className="ratio-portrait w-full object-cover" />
                      <span className="block px-3 py-3">
                        <span className="block font-display text-2xl leading-none tracking-wide uppercase">
                          {barber.name}
                        </span>
                        <span className="mt-1 block text-sm text-mist">{barber.specialty}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {state.step === 3 && (
            <div>
              <Back onClick={() => go(2)} />
              {!mounted ? (
                <p className="mt-4 text-mist">Carregando a agenda…</p>
              ) : (
                <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
                  {days.map((item) => (
                    <DayButton
                      key={item.iso}
                      day={item}
                      selected={item.iso === state.date}
                      onPick={() =>
                        setState((s) => ({
                          ...s,
                          date: item.iso,
                          time: null,
                          step: 4,
                        }))
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {state.step === 4 && (
            <div>
              <Back onClick={() => go(3)} />
              {day && (
                <p className="mt-4 text-sm text-mist">
                  {dateLabel(day)} · serviço de {duration} min
                </p>
              )}
              {askAgain && (
                <p className="mt-3 text-sm text-gold">
                  Esse horário não cabe no serviço escolhido. Escolha outro.
                </p>
              )}
              {slotRows.length === 0 ? (
                <p className="mt-4 border border-line px-4 py-6 text-mist">
                  {dayHasLaterSlot
                    ? "Não há horário que caiba nesse serviço neste dia. Escolha outro dia."
                    : "Os horários deste dia já passaram. Escolha outra data."}
                </p>
              ) : (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slotRows.map((slot) => (
                    <button
                      key={slot.time}
                      type="button"
                      disabled={slot.taken}
                      onClick={() => {
                        setAskAgain(false);
                        setState((s) => ({ ...s, time: slot.time, step: 5 }));
                      }}
                      className={`min-h-12 border px-2 py-3 font-display text-xl tracking-wide tabular-nums ${
                        slot.taken
                          ? "cursor-not-allowed border-line text-mist line-through decoration-mist/60"
                          : state.time === slot.time
                            ? "border-gold bg-gold text-ink"
                            : "border-line text-cream"
                      }`}
                    >
                      <span className="block leading-none">{slot.time}</span>
                      {slot.taken && (
                        <span className="mt-1 block text-xs font-sans font-medium tracking-wide no-underline">
                          Ocupado
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {state.step === 5 && service && day && state.time && (
            <form
              className="border border-line bg-ink p-4 md:p-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (confirmHref) window.open(confirmHref, "_blank", "noopener,noreferrer");
              }}
            >
              <Back onClick={() => go(4)} />
              <div className="mt-4 grid gap-3">
                <label className="block">
                  <span className="text-xs tracking-widest text-mist uppercase">Nome</span>
                  <input
                    required
                    minLength={2}
                    name="nome"
                    autoComplete="name"
                    value={state.name}
                    onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
                    placeholder="Seu nome"
                    className="mt-1 w-full border border-line bg-panel-2 px-4 py-3 text-cream placeholder:text-mist/70"
                  />
                </label>
                <label className="block">
                  <span className="text-xs tracking-widest text-mist uppercase">Telefone (opcional)</span>
                  <input
                    name="telefone"
                    autoComplete="tel"
                    inputMode="tel"
                    value={state.phone}
                    onChange={(e) => setState((s) => ({ ...s, phone: e.target.value }))}
                    placeholder="(71) 99999-0000"
                    className="mt-1 w-full border border-line bg-panel-2 px-4 py-3 text-cream placeholder:text-mist/70"
                  />
                </label>
              </div>

              <dl className="mt-6 divide-y divide-line border-y border-line text-sm">
                <SummaryRow label="Serviço" value={`${service.name} · ${brl(service.price)} · ${service.duration} min`} />
                <SummaryRow label="Barbeiro" value={barberName(state.barberId)} />
                <SummaryRow label="Data" value={dateLabel(day)} />
                <SummaryRow label="Horário" value={state.time} />
                <SummaryRow label="Total" value={brl(service.price)} strong />
              </dl>

              {confirmHref ? (
                <a
                  href={confirmHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 flex min-h-12 items-center justify-center bg-gold px-5 py-3 text-center font-display text-xl tracking-widest text-ink uppercase"
                >
                  Confirmar pelo WhatsApp
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="mt-6 flex min-h-12 w-full items-center justify-center bg-gold/40 px-5 py-3 font-display text-xl tracking-widest text-ink uppercase"
                >
                  Confirmar pelo WhatsApp
                </button>
              )}
              <p className="mt-3 text-center text-xs text-mist">
                {nameOk
                  ? "Nada é cobrado aqui. A conversa abre no WhatsApp da barbearia."
                  : "Digite seu nome para liberar a confirmação."}
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1 text-sm tracking-wide text-gold uppercase"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      Voltar
    </button>
  );
}

function DayButton({
  day,
  selected,
  onPick,
}: {
  day: DayCell;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={day.closed}
      onClick={onPick}
      className={`w-16 shrink-0 border px-1 py-3 text-center ${
        day.closed
          ? "cursor-not-allowed border-line text-mist/50"
          : selected
            ? "border-gold bg-gold text-ink"
            : "border-line text-cream"
      }`}
    >
      <span className="block text-xs tracking-wide uppercase">
        {day.isToday ? "Hoje" : WEEKDAYS_SHORT[day.weekday]}
      </span>
      <span className="mt-1 block font-display text-3xl leading-none tabular-nums">{day.day}</span>
      <span className="mt-1 block text-xs tracking-wide uppercase">{MONTHS_SHORT[day.month - 1]}</span>
      {day.closed && <span className="mt-1 block text-xs uppercase">Fechado</span>}
    </button>
  );
}

function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-xs tracking-widest text-mist uppercase">{label}</dt>
      <dd className={`text-right ${strong ? "font-display text-3xl text-gold" : "text-cream"}`}>{value}</dd>
    </div>
  );
}
