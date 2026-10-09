import { ANY_BARBER, shop, type DayHours } from "@/shop-config";

const TZ = shop.timezone;

export const WEEKDAYS_LONG = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

export const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export const MONTHS_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export type DayCell = {
  iso: string;
  day: number;
  month: number;
  weekday: number;
  closed: boolean;
  isToday: boolean;
};

type Zoned = { y: number; m: number; d: number; minutes: number };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Wall-clock parts in the shop timezone (America/Bahia for Barbearia Leme). */
export function bahiaNow(date = new Date()): Zoned {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0;
  return { y: get("year"), m: get("month"), d: get("day"), minutes: hour * 60 + get("minute") };
}

function shift(y: number, m: number, d: number, add: number) {
  const dt = new Date(Date.UTC(y, m - 1, d + add));
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    weekday: dt.getUTCDay(),
  };
}

export function isoOf(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function hoursFor(weekday: number): DayHours | undefined {
  return shop.hours.find((h) => h.day === weekday);
}

export function upcomingDays(count = 14, now = bahiaNow()): DayCell[] {
  return Array.from({ length: count }, (_, i) => {
    const z = shift(now.y, now.m, now.d, i);
    const hours = hoursFor(z.weekday);
    return {
      iso: isoOf(z.y, z.m, z.d),
      day: z.d,
      month: z.m,
      weekday: z.weekday,
      closed: !hours || hours.closed,
      isToday: i === 0,
    };
  });
}

/** Grid times, every `slotMinutes`, where the service still ends before close. */
export function slotsFor(weekday: number, durationMinutes = shop.slotMinutes): string[] {
  const hours = hoursFor(weekday);
  if (!hours || hours.closed) return [];
  const [oh, om] = hours.open.split(":").map(Number);
  const [ch, cm] = hours.close.split(":").map(Number);
  const start = oh * 60 + om;
  const end = ch * 60 + cm;
  const need = Math.max(1, durationMinutes);
  const out: string[] = [];
  for (let t = start; t + need <= end; t += shop.slotMinutes) {
    out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  }
  return out;
}

export function weekdayFromIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

/** The chosen time still fits the service and is not already in the past. */
export function chosenTimeStillFits(iso: string | null, time: string | null, durationMinutes: number) {
  if (!iso || !time) return false;
  return (
    slotsFor(weekdayFromIso(iso), durationMinutes).includes(time) && !isPastSlot(iso, time)
  );
}

export function isPastSlot(iso: string, time: string, now = bahiaNow()) {
  if (iso !== isoOf(now.y, now.m, now.d)) return false;
  const [hh, mm] = time.split(":").map(Number);
  return hh * 60 + mm <= now.minutes;
}

/** Demo-only: the same barber + day + time is always taken or free across reloads. */
export function isSlotTaken(barberId: string, iso: string, time: string) {
  const key = `${barberId}|${iso}|${time}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 7 < 2;
}

export function dateLabel(day: DayCell) {
  const name = WEEKDAYS_LONG[day.weekday] ?? "";
  const titled = name.charAt(0).toUpperCase() + name.slice(1);
  return `${titled}, ${pad(day.day)}/${pad(day.month)}`;
}

export function brl(value: number) {
  return `R$ ${value.toLocaleString("pt-BR")}`;
}

export function barberName(id: string | null) {
  if (!id || id === ANY_BARBER) return "Sem preferência";
  return shop.barbers.find((b) => b.id === id)?.name ?? "Sem preferência";
}

function clockLabel(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  if (!m) return `${h}h`;
  return `${h}h${pad(m)}`;
}

export function hoursLine() {
  const open = shop.hours.filter((h) => !h.closed);
  if (!open.length) return "Consulte os horários";
  const first = open[0];
  const last = open[open.length - 1];
  if (!first || first.closed || !last || last.closed) return "";
  const span = `${first.label} a ${last.label}`;
  const sameClock = open.every((h) => !h.closed && h.open === first.open && h.close === first.close);
  if (sameClock) return `${span} · ${clockLabel(first.open)} às ${clockLabel(first.close)}`;
  const earliest = open.reduce((min, h) => (!h.closed && h.open < min ? h.open : min), "99:99");
  const latest = open.reduce((max, h) => (!h.closed && h.close > max ? h.close : max), "00:00");
  return `${span} · ${clockLabel(earliest)} às ${clockLabel(latest)}`;
}
