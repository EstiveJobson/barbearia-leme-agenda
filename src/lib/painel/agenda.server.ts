import { getSql, type Sql } from "@/lib/db";
import { customerWhatsAppLink, maskBrazilianPhone } from "@/lib/agenda/phone";
import { zonedSlotToUtc } from "@/lib/agenda/time";
import type { OwnerContext } from "@/lib/painel/auth.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

export type AgendaView = "today" | "week";

export type AgendaInput = {
  view: AgendaView;
  barberId: string | null;
  includeCancelled: boolean;
};

export type BookingCard = {
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

export type BlockCard = {
  id: string;
  barberName: string;
  allDay: boolean;
  startLabel: string;
  endLabel: string;
  reason: string | null;
};

export type AgendaDay = {
  iso: string;
  label: string;
  bookings: BookingCard[];
  blocks: BlockCard[];
};

export type AgendaData = {
  shopName: string;
  days: AgendaDay[];
  barbers: { id: string; name: string }[];
};

export type BlockInput = {
  barberId: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  reason: string;
};

type Fail = { ok: false; status: 401 | 404 | 400; message?: string };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1)).getUTCDay();
}

function zonedIso(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function clock(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${hour}:${get("minute")}`;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid timestamp from database");
  return parsed;
}

function dayLabel(iso: string, today: string): string {
  if (iso === today) return "Hoje";
  const [year, month, day] = iso.split("-").map(Number);
  const name = WEEKDAYS[weekdayOf(iso)] ?? "";
  const titled = name.charAt(0).toUpperCase() + name.slice(1);
  return `${titled}, ${pad(day)}/${pad(month)}/${year}`;
}

function viewDays(view: AgendaView, timeZone: string, now: Date): { today: string; days: string[] } {
  const today = zonedIso(now, timeZone);
  if (view === "today") return { today, days: [today] };
  const weekday = weekdayOf(today);
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = addDays(today, mondayOffset);
  return { today, days: Array.from({ length: 7 }, (_, index) => addDays(monday, index)) };
}

function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID.test(value);
}

function dateOk(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function timeOk(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59;
}

function minutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

export async function loadAgenda(
  owner: OwnerContext,
  input: AgendaInput,
  now = new Date(),
): Promise<{ ok: true; data: AgendaData } | Fail> {
  const sql = await getSql();
  if (input.barberId && !isUuid(input.barberId)) return { ok: false, status: 404 };
  if (input.barberId) {
    const owned = await sql<{ id: string }>`
      select id from barbers where id = ${input.barberId} and shop_id = ${owner.shopId} limit 1
    `;
    if (!owned.length) return { ok: false, status: 404 };
  }

  const { today, days } = viewDays(input.view, owner.timezone, now);
  const rangeStart = zonedSlotToUtc(days[0] ?? today, "00:00", owner.timezone);
  const rangeEnd = zonedSlotToUtc(addDays(days[days.length - 1] ?? today, 1), "00:00", owner.timezone);

  const barbers = await sql<{ id: string; name: string }>`
    select id, name from barbers where shop_id = ${owner.shopId} order by sort_order, name
  `;

  const bookings = input.barberId
    ? await sql<BookingRow>`
        select b.id, b.customer_name, b.customer_phone, b.starts_at, b.ends_at, b.status,
               s.name as service_name, br.name as barber_name
        from bookings b
        join services s on s.id = b.service_id and s.shop_id = b.shop_id
        join barbers br on br.id = b.barber_id and br.shop_id = b.shop_id
        where b.shop_id = ${owner.shopId}
          and b.barber_id = ${input.barberId}
          and b.starts_at < ${rangeEnd}
          and b.ends_at > ${rangeStart}
          and (${input.includeCancelled}::boolean or b.status = 'active')
        order by b.starts_at
      `
    : await sql<BookingRow>`
        select b.id, b.customer_name, b.customer_phone, b.starts_at, b.ends_at, b.status,
               s.name as service_name, br.name as barber_name
        from bookings b
        join services s on s.id = b.service_id and s.shop_id = b.shop_id
        join barbers br on br.id = b.barber_id and br.shop_id = b.shop_id
        where b.shop_id = ${owner.shopId}
          and b.starts_at < ${rangeEnd}
          and b.ends_at > ${rangeStart}
          and (${input.includeCancelled}::boolean or b.status = 'active')
        order by b.starts_at
      `;

  const blocks = input.barberId
    ? await sql<BlockRow>`
        select bl.id, bl.starts_at, bl.ends_at, bl.all_day, bl.reason, br.name as barber_name
        from blocks bl
        join barbers br on br.id = bl.barber_id and br.shop_id = bl.shop_id
        where bl.shop_id = ${owner.shopId}
          and bl.barber_id = ${input.barberId}
          and bl.starts_at < ${rangeEnd}
          and bl.ends_at > ${rangeStart}
        order by bl.starts_at
      `
    : await sql<BlockRow>`
        select bl.id, bl.starts_at, bl.ends_at, bl.all_day, bl.reason, br.name as barber_name
        from blocks bl
        join barbers br on br.id = bl.barber_id and br.shop_id = bl.shop_id
        where bl.shop_id = ${owner.shopId}
          and bl.starts_at < ${rangeEnd}
          and bl.ends_at > ${rangeStart}
        order by bl.starts_at
      `;

  const byDay = new Map<string, AgendaDay>(
    days.map((iso) => [iso, { iso, label: dayLabel(iso, today), bookings: [], blocks: [] }]),
  );

  for (const row of bookings) {
    const starts = asDate(row.starts_at);
    const iso = zonedIso(starts, owner.timezone);
    const day = byDay.get(iso);
    if (!day) continue;
    const status = row.status === "cancelled" ? "cancelled" : "active";
    day.bookings.push({
      id: row.id,
      customerName: row.customer_name,
      phoneLabel: row.customer_phone ? maskBrazilianPhone(row.customer_phone) : "Sem telefone",
      waUrl: customerWhatsAppLink(row.customer_phone),
      serviceName: row.service_name,
      barberName: row.barber_name,
      startLabel: clock(starts, owner.timezone),
      endLabel: clock(asDate(row.ends_at), owner.timezone),
      status,
    });
  }

  for (const row of blocks) {
    const starts = asDate(row.starts_at);
    const iso = zonedIso(starts, owner.timezone);
    const day = byDay.get(iso);
    if (!day) continue;
    day.blocks.push({
      id: row.id,
      barberName: row.barber_name,
      allDay: row.all_day,
      startLabel: clock(starts, owner.timezone),
      endLabel: clock(asDate(row.ends_at), owner.timezone),
      reason: row.reason?.trim() ? row.reason.trim() : null,
    });
  }

  return {
    ok: true,
    data: { shopName: owner.shopName, days: days.map((iso) => byDay.get(iso)!), barbers },
  };
}

type BookingRow = {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  starts_at: unknown;
  ends_at: unknown;
  status: string;
  service_name: string;
  barber_name: string;
};

type BlockRow = {
  id: string;
  starts_at: unknown;
  ends_at: unknown;
  all_day: boolean;
  reason: string | null;
  barber_name: string;
};

export async function cancelBooking(owner: OwnerContext, bookingId: string): Promise<{ ok: true } | Fail> {
  if (!isUuid(bookingId)) return { ok: false, status: 404 };
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update bookings
    set status = 'cancelled'
    where id = ${bookingId}
      and shop_id = ${owner.shopId}
      and status = 'active'
    returning id
  `;
  if (!rows.length) return { ok: false, status: 404 };
  return { ok: true };
}

export async function createBlock(
  owner: OwnerContext,
  input: BlockInput,
): Promise<{ ok: true } | Fail> {
  if (!isUuid(input.barberId)) return { ok: false, status: 404 };
  if (!dateOk(input.date)) return { ok: false, status: 400, message: "Escolha o dia." };
  const today = zonedIso(new Date(), owner.timezone);
  const oldest = addDays(today, -366);
  const newest = addDays(today, 366);
  if (input.date < oldest || input.date > newest) {
    return { ok: false, status: 400, message: "Escolha um dia dentro de um ano." };
  }
  const reason = input.reason.trim().replace(/\s+/g, " ");
  if (reason.length > 200) {
    return { ok: false, status: 400, message: "O motivo pode ter no máximo 200 caracteres." };
  }

  let startsAt: Date;
  let endsAt: Date;
  if (input.allDay) {
    startsAt = zonedSlotToUtc(input.date, "00:00", owner.timezone);
    endsAt = zonedSlotToUtc(addDays(input.date, 1), "00:00", owner.timezone);
  } else {
    if (!timeOk(input.start) || !timeOk(input.end)) {
      return { ok: false, status: 400, message: "Informe o início e o fim." };
    }
    if (minutes(input.end) <= minutes(input.start)) {
      return { ok: false, status: 400, message: "O fim precisa ser depois do início." };
    }
    startsAt = zonedSlotToUtc(input.date, input.start, owner.timezone);
    endsAt = zonedSlotToUtc(input.date, input.end, owner.timezone);
  }

  const sql = await getSql();
  const barber = await sql<{ id: string }>`
    select id from barbers where id = ${input.barberId} and shop_id = ${owner.shopId} limit 1
  `;
  if (!barber.length) return { ok: false, status: 404 };

  await sql`
    insert into blocks (shop_id, barber_id, starts_at, ends_at, all_day, reason)
    values (
      ${owner.shopId},
      ${input.barberId},
      ${startsAt},
      ${endsAt},
      ${input.allDay},
      ${reason || null}
    )
  `;
  return { ok: true };
}

export async function removeBlock(owner: OwnerContext, blockId: string): Promise<{ ok: true } | Fail> {
  if (!isUuid(blockId)) return { ok: false, status: 404 };
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    delete from blocks
    where id = ${blockId} and shop_id = ${owner.shopId}
    returning id
  `;
  if (!rows.length) return { ok: false, status: 404 };
  return { ok: true };
}

/** Used by tests that need a raw query after a panel action. */
export function panelSql(): Promise<Sql> {
  return getSql();
}
