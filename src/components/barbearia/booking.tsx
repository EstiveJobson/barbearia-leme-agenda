import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronLeft, UserRound } from "lucide-react";
import { ANY_BARBER, shop } from "@/shop-config";
import {
  MONTHS_SHORT,
  WEEKDAYS_SHORT,
  bahiaNow,
  brl,
  dateLabel,
  isoOf,
  weekdayFromIso,
  type DayCell,
} from "@/lib/schedule";
import { maskBrazilianPhone, parseBrazilianPhone } from "@/lib/agenda/phone";
import { fetchBookingDays, fetchFreeSlots, submitBooking } from "@/lib/agenda/booking.functions";

const STEPS = ["Serviço", "Barbeiro", "Dia", "Horário", "Dados", "Revisão"] as const;
const TAKEN = "Esse horário acabou de ser ocupado. Escolha outro, por favor.";

export type BookingState = {
  step: 1 | 2 | 3 | 4 | 5 | 6;
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

type Success = {
  serviceName: string;
  barberName: string;
  dayLabel: string;
  time: string;
  priceLabel: string;
  waUrl: string | null;
  waNotice: string | null;
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
  const [days, setDays] = useState<DayCell[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [loadingDays, setLoadingDays] = useState(false);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [takenNote, setTakenNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);
  const [refreshTimes, setRefreshTimes] = useState(0);
  const [daysFor, setDaysFor] = useState("");
  const [slotsFor, setSlotsFor] = useState("");
  const skipScroll = useRef(true);
  const selectionKey = `${state.step}|${state.serviceId ?? ""}|${state.barberId ?? ""}|${state.date ?? ""}|${state.time ?? ""}`;
  const selectionRef = useRef(selectionKey);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (skipScroll.current) {
      skipScroll.current = false;
      return;
    }
    scrollToBooking();
  }, [state.step, success]);

  useEffect(() => {
    if (selectionRef.current === selectionKey) return;
    selectionRef.current = selectionKey;
    setSuccess(null);
  }, [selectionKey]);

  const service = shop.services.find((item) => item.id === state.serviceId) ?? null;
  const barber = shop.barbers.find((item) => item.id === state.barberId) ?? null;
  const day = days.find((item) => item.iso === state.date) ?? null;
  const phoneCheck = parseBrazilianPhone(state.phone);
  const nameOk = state.name.trim().length >= 2;

  useEffect(() => {
    if (!mounted || !state.barberId) return;
    let cancel = false;
    setLoadingDays(true);
    setLoadError(null);
    void fetchBookingDays({ data: { barberSlug: state.barberId } })
      .then((result) => {
        if (cancel) return;
        if (!result.ok) {
          setLoadError(result.message);
          setDays([]);
          setDaysFor(state.barberId ?? "");
          return;
        }
        const now = bahiaNow();
        const today = isoOf(now.y, now.m, now.d);
        setDays(
          result.days.map((item) => ({
            iso: item.iso,
            day: Number(item.iso.slice(8, 10)),
            month: Number(item.iso.slice(5, 7)),
            weekday: weekdayFromIso(item.iso),
            closed: item.closed,
            isToday: item.iso === today,
          })),
        );
        setDaysFor(state.barberId ?? "");
      })
      .catch(() => {
        if (!cancel) {
          setLoadError("Não foi possível carregar os dias. Tente de novo.");
          setDaysFor(state.barberId ?? "");
        }
      })
      .finally(() => {
        if (!cancel) setLoadingDays(false);
      });
    return () => {
      cancel = true;
    };
  }, [mounted, state.barberId]);

  useEffect(() => {
    if (state.step !== 4 || !state.serviceId || !state.barberId || !state.date) return;
    let cancel = false;
    setLoadingTimes(true);
    setLoadError(null);
    void fetchFreeSlots({
      data: { serviceSlug: state.serviceId, barberSlug: state.barberId, date: state.date },
    })
      .then((result) => {
        if (cancel) return;
        if (!result.ok) {
          setLoadError(result.message);
          setTimes([]);
          setSlotsFor(`${state.serviceId}|${state.barberId}|${state.date}|${refreshTimes}`);
          return;
        }
        setTimes(result.times);
        setSlotsFor(`${state.serviceId}|${state.barberId}|${state.date}|${refreshTimes}`);
      })
      .catch(() => {
        if (!cancel) {
          setLoadError("Não foi possível carregar os horários. Tente de novo.");
          setSlotsFor(`${state.serviceId}|${state.barberId}|${state.date}|${refreshTimes}`);
        }
      })
      .finally(() => {
        if (!cancel) setLoadingTimes(false);
      });
    return () => {
      cancel = true;
    };
  }, [state.step, state.serviceId, state.barberId, state.date, refreshTimes]);

  const waitingDays = Boolean(state.barberId) && daysFor !== state.barberId;
  const slotsKey = `${state.serviceId}|${state.barberId}|${state.date}|${refreshTimes}`;
  const waitingSlots = state.step === 4 && slotsFor !== slotsKey;

  function go(step: BookingState["step"]) {
    setFormError(null);
    setState((current) => ({ ...current, step }));
  }

  function reachable(step: number) {
    if (step <= 1) return true;
    if (!service) return false;
    if (step === 2) return true;
    if (!state.barberId) return false;
    if (step === 3) return true;
    if (!state.date || day?.closed) return false;
    if (step === 4) return true;
    if (!state.time) return false;
    if (step === 5) return true;
    return nameOk && phoneCheck.ok;
  }

  async function confirm() {
    if (!service || !state.barberId || !state.date || !state.time || submitting) return;
    if (!nameOk || !phoneCheck.ok) {
      setFormError(!phoneCheck.ok ? phoneCheck.message : "Informe seu nome.");
      return;
    }
    const popup = window.open("", "_blank");
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await submitBooking({
        data: {
          serviceSlug: service.id,
          barberSlug: state.barberId,
          date: state.date,
          time: state.time,
          name: state.name,
          phone: state.phone,
        },
      });
      if (!result.ok) {
        popup?.close();
        if (result.code === "slot_taken") {
          setTakenNote(TAKEN);
          setTimes((current) => current.filter((time) => time !== state.time));
          setRefreshTimes((value) => value + 1);
          setState((current) => ({ ...current, time: null, step: 4 }));
          return;
        }
        setFormError(result.message);
        return;
      }
      setSuccess(result.result);
      setTakenNote(null);
      if (result.result.waUrl) {
        if (popup) popup.location.href = result.result.waUrl;
        else window.open(result.result.waUrl, "_blank", "noopener,noreferrer");
      } else {
        popup?.close();
      }
    } catch {
      popup?.close();
      setFormError("Não foi possível concluir o agendamento. Tente de novo.");
    } finally {
      setSubmitting(false);
    }
  }

  const barberLabel = state.barberId === ANY_BARBER ? "Qualquer um" : (barber?.name ?? "Qualquer um");

  if (success) {
    return (
      <section id="agendar" className="scroll-mt-20 border-t border-line bg-panel">
        <div className="mx-auto max-w-3xl px-5 py-16 md:py-24">
          <p className="text-xs font-medium tracking-widest text-gold uppercase">Agenda</p>
          <h2 className="mt-2 font-display text-5xl leading-none uppercase md:text-6xl">
            Agendamento confirmado!
          </h2>
          <p className="mt-4 max-w-xl text-pretty text-mist">
            {success.waUrl
              ? "O horário ficou reservado. Se o WhatsApp não abriu, use o botão abaixo."
              : success.waNotice}
          </p>
          <dl className="mt-8 divide-y divide-line border-y border-line text-sm">
            <SummaryRow label="Serviço" value={success.serviceName} />
            <SummaryRow label="Barbeiro" value={success.barberName} />
            <SummaryRow label="Dia" value={success.dayLabel} />
            <SummaryRow label="Horário" value={success.time} />
            <SummaryRow label="Preço" value={success.priceLabel} strong />
          </dl>
          {success.waUrl && (
            <a
              href={success.waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 flex min-h-12 items-center justify-center bg-gold px-5 py-3 text-center font-display text-xl tracking-widest text-ink uppercase"
            >
              Abrir WhatsApp
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              setSuccess(null);
              setState(initialBooking);
            }}
            className="mt-3 flex min-h-11 w-full items-center justify-center text-sm tracking-wide text-gold uppercase"
          >
            Agendar outro horário
          </button>
        </div>
      </section>
    );
  }

  return (
    <section id="agendar" className="scroll-mt-20 border-t border-line bg-panel">
      <div className="mx-auto max-w-3xl px-5 py-16 md:py-24">
        <p className="text-xs font-medium tracking-widest text-gold uppercase">Agenda</p>
        <h2 className="mt-2 font-display text-5xl leading-none uppercase md:text-6xl">
          Agende seu horário
        </h2>
        <p className="mt-4 max-w-xl text-pretty text-mist">
          Escolha o serviço, o barbeiro e o horário. A reserva fica salva aqui e a conversa segue no WhatsApp.
        </p>

        <div className="mt-8" aria-label="Etapas do agendamento">
          <div className="flex gap-1.5">
            {STEPS.map((label, index) => {
              const n = (index + 1) as BookingState["step"];
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
            <span className="text-mist"> / 06</span>
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
              {shop.services.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setState((current) => ({
                        ...current,
                        serviceId: item.id,
                        time: null,
                        step: 2,
                      }))
                    }
                    className="flex w-full items-start gap-4 py-4 text-left"
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
              ))}
            </ul>
          )}

          {state.step === 2 && (
            <div>
              <Back onClick={() => go(1)} />
              <button
                type="button"
                onClick={() =>
                  setState((current) => ({
                    ...current,
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
                    Qualquer um
                  </span>
                  <span className="mt-1 block text-sm text-mist">O primeiro barbeiro livre nesse horário</span>
                </span>
              </button>
              <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
                {shop.barbers.map((item) => {
                  const selected = state.barberId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setState((current) => ({
                          ...current,
                          barberId: item.id,
                          time: null,
                          step: 3,
                        }))
                      }
                      className={`w-40 shrink-0 overflow-hidden border text-left ${selected ? "border-gold" : "border-line"}`}
                    >
                      <img src={item.photo} alt="" className="ratio-portrait w-full object-cover" />
                      <span className="block px-3 py-3">
                        <span className="block font-display text-2xl leading-none tracking-wide uppercase">
                          {item.name}
                        </span>
                        <span className="mt-1 block text-sm text-mist">{item.specialty}</span>
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
              {loadingDays || waitingDays ? (
                <p className="mt-4 text-mist">Carregando a agenda…</p>
              ) : (
                <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
                  {days.map((item) => (
                    <DayButton
                      key={item.iso}
                      day={item}
                      selected={item.iso === state.date}
                      onPick={() =>
                        setState((current) => ({
                          ...current,
                          date: item.iso,
                          time: null,
                          step: 4,
                        }))
                      }
                    />
                  ))}
                </div>
              )}
              {loadError && <p className="mt-3 text-sm text-gold">{loadError}</p>}
            </div>
          )}

          {state.step === 4 && (
            <div>
              <Back onClick={() => go(3)} />
              {day && (
                <p className="mt-4 text-sm text-mist">
                  {dateLabel(day)} · serviço de {service?.duration} min
                </p>
              )}
              {takenNote && <p className="mt-3 text-sm text-gold">{takenNote}</p>}
              {loadingTimes || waitingSlots ? (
                <p className="mt-4 text-mist">Carregando horários livres…</p>
              ) : times.length === 0 ? (
                <p className="mt-4 border border-line px-4 py-6 text-mist">
                  Não há horário livre neste dia. Escolha outra data.
                </p>
              ) : (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {times.map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => {
                        setTakenNote(null);
                        setState((current) => ({ ...current, time, step: 5 }));
                      }}
                      className={`min-h-12 border px-2 py-3 font-display text-xl tracking-wide tabular-nums ${
                        state.time === time ? "border-gold bg-gold text-ink" : "border-line text-cream"
                      }`}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              )}
              {loadError && <p className="mt-3 text-sm text-gold">{loadError}</p>}
            </div>
          )}

          {state.step === 5 && (
            <form
              className="border border-line bg-ink p-4 md:p-6"
              onSubmit={(event) => {
                event.preventDefault();
                if (!nameOk) {
                  setFormError("Informe seu nome.");
                  return;
                }
                if (!phoneCheck.ok) {
                  setFormError(phoneCheck.message);
                  return;
                }
                setFormError(null);
                go(6);
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
                    onChange={(event) => setState((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Seu nome"
                    className="mt-1 min-h-12 w-full border border-line bg-panel-2 px-4 py-3 text-cream placeholder:text-mist/70"
                  />
                </label>
                <label className="block">
                  <span className="text-xs tracking-widest text-mist uppercase">Telefone</span>
                  <input
                    required
                    name="telefone"
                    autoComplete="tel"
                    inputMode="tel"
                    value={state.phone}
                    onChange={(event) =>
                      setState((current) => ({ ...current, phone: maskBrazilianPhone(event.target.value) }))
                    }
                    placeholder="(71) 99999-9999"
                    className="mt-1 min-h-12 w-full border border-line bg-panel-2 px-4 py-3 text-cream placeholder:text-mist/70"
                  />
                </label>
              </div>
              {formError && <p className="mt-3 text-sm text-gold">{formError}</p>}
              <button
                type="submit"
                className="mt-6 flex min-h-12 w-full items-center justify-center bg-gold px-5 py-3 font-display text-xl tracking-widest text-ink uppercase"
              >
                Continuar
              </button>
            </form>
          )}

          {state.step === 6 && service && day && state.time && (
            <div className="border border-line bg-ink p-4 md:p-6">
              <Back onClick={() => go(5)} />
              <dl className="mt-4 divide-y divide-line border-y border-line text-sm">
                <SummaryRow label="Serviço" value={service.name} />
                <SummaryRow label="Barbeiro" value={barberLabel} />
                <SummaryRow label="Dia" value={dateLabel(day)} />
                <SummaryRow label="Horário" value={state.time} />
                <SummaryRow label="Preço" value={brl(service.price)} strong />
              </dl>
              {formError && <p className="mt-3 text-sm text-gold">{formError}</p>}
              <button
                type="button"
                disabled={submitting}
                onClick={() => void confirm()}
                className="mt-6 flex min-h-12 w-full items-center justify-center bg-gold px-5 py-3 font-display text-xl tracking-widest text-ink uppercase disabled:cursor-wait disabled:opacity-70"
              >
                {submitting ? "Confirmando…" : "Confirmar agendamento"}
              </button>
            </div>
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
