import { getSql, withTransaction, type Sql } from "@/lib/db";
import { PUBLIC_SHOP_SLUG } from "@/lib/agenda/shop.server";
import { bookingWindow } from "@/lib/agenda/time";
import { parseBrazilianPhone } from "@/lib/agenda/phone";
import { freeStartTimes, rangesOverlap, unionFreeTimes, type BusyRange, type Shift } from "@/lib/agenda/slots";
import { ANY_BARBER_SLUG, BookingRejected } from "@/lib/agenda/booking-error";
import { allowBookingAttempt, RATE_LIMIT_MESSAGE } from "@/lib/agenda/rate-limit";
import { notifyNewBooking, type BookingNotice } from "@/lib/agenda/notify.server";
import { NO_SHOP_WHATSAPP, shopWhatsAppLink } from "@/lib/agenda/whatsapp.server";
const DAY_COUNT = 14;

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

type ShopContext = {
  id: string;
  timezone: string;
  slotMinutes: number;
};

type ServiceRow = {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  duration_minutes: number;
};

type BarberRow = {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
};

export type DayOption = { iso: string; closed: boolean };

export type ConfirmInput = {
  serviceSlug: string;
  barberSlug: string;
  date: string;
  time: string;
  name: string;
  phone: string;
};

export type ConfirmResult = {
  serviceName: string;
  barberName: string;
  dayLabel: string;
  time: string;
  priceLabel: string;
  waUrl: string | null;
  waNotice: string | null;
};

function slugOk(value: string): boolean {
  return /^[a-z0-9-]{1,40}$/.test(value);
}

function dateOk(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function timeOk(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value);
}

function clockLabel(value: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
}

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

/** YYYY-MM-DD in the shop timezone. */
export function zonedIso(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, (month || 1) - 1, day || 1)).getUTCDay()] ?? "";
  return `${weekday}, ${pad(day)}/${pad(month)}`;
}

function priceLabel(cents: number): string {
  const reais = cents / 100;
  return `R$ ${reais.toLocaleString("pt-BR")}`;
}

function waMessage(serviceName: string, barberName: string, label: string, time: string, name: string): string {
  return `Olá! Acabei de agendar pelo site: ${serviceName} com ${barberName} em ${label} às ${time}. Nome: ${name}.`;
}

async function publicShop(sql: Sql): Promise<ShopContext> {
  const rows = await sql<{ id: string; timezone: string; slot_minutes: number }>`
    select id, timezone, slot_minutes
    from shops
    where slug = ${PUBLIC_SHOP_SLUG}
    limit 1
  `;
  const shop = rows[0];
  if (!shop) {
    throw new BookingRejected(
      "unavailable",
      "A agenda ainda não está disponível. Tente de novo em instantes.",
    );
  }
  return { id: shop.id, timezone: shop.timezone, slotMinutes: shop.slot_minutes };
}

async function serviceForShop(sql: Sql, shopId: string, serviceSlug: string): Promise<ServiceRow> {
  if (!slugOk(serviceSlug)) {
    throw new BookingRejected("invalid", "Escolha um serviço da lista.");
  }
  const rows = await sql<ServiceRow>`
    select id, slug, name, price_cents, duration_minutes
    from services
    where shop_id = ${shopId} and slug = ${serviceSlug}
    limit 1
  `;
  const service = rows[0];
  if (!service) throw new BookingRejected("invalid", "Escolha um serviço da lista.");
  return service;
}

async function barbersForRequest(sql: Sql, shopId: string, barberSlug: string): Promise<BarberRow[]> {
  if (barberSlug === ANY_BARBER_SLUG) {
    return sql<BarberRow>`
      select id, slug, name, sort_order
      from barbers
      where shop_id = ${shopId}
      order by sort_order, name
    `;
  }
  if (!slugOk(barberSlug)) throw new BookingRejected("invalid", "Escolha um barbeiro.");
  return sql<BarberRow>`
    select id, slug, name, sort_order
    from barbers
    where shop_id = ${shopId} and slug = ${barberSlug}
    order by sort_order, name
  `;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid timestamp from database");
  return parsed;
}

function shiftClock(value: unknown): string {
  return clockLabel(String(value));
}

async function shiftsFor(sql: Sql, shopId: string, barberId: string, weekday: number): Promise<Shift[]> {
  const rows = await sql<{ start_time: unknown; end_time: unknown }>`
    select start_time, end_time
    from weekly_schedule
    where shop_id = ${shopId} and barber_id = ${barberId} and weekday = ${weekday}
  `;
  return rows.map((row) => ({ start: shiftClock(row.start_time), end: shiftClock(row.end_time) }));
}

async function busyFor(
  sql: Sql,
  shopId: string,
  barberId: string,
  date: string,
  timeZone: string,
): Promise<BusyRange[]> {
  const dayStart = bookingWindow(date, "00:00", 0, timeZone).startsAt;
  const dayEnd = bookingWindow(addDays(date, 1), "00:00", 0, timeZone).startsAt;
  const bookings = await sql<{ starts_at: unknown; ends_at: unknown }>`
    select starts_at, ends_at
    from bookings
    where shop_id = ${shopId}
      and barber_id = ${barberId}
      and status = 'active'
      and starts_at < ${dayEnd}
      and ends_at > ${dayStart}
  `;
  const blocks = await sql<{ starts_at: unknown; ends_at: unknown; all_day: boolean }>`
    select starts_at, ends_at, all_day
    from blocks
    where shop_id = ${shopId}
      and barber_id = ${barberId}
      and (
        (starts_at < ${dayEnd} and ends_at > ${dayStart})
        or all_day
      )
  `;
  const ranges: BusyRange[] = bookings.map((row) => ({
    startsAt: asDate(row.starts_at),
    endsAt: asDate(row.ends_at),
  }));
  for (const block of blocks) {
    if (block.all_day) {
      if (zonedIso(asDate(block.starts_at), timeZone) === date) {
        ranges.push({ startsAt: dayStart, endsAt: dayEnd });
      }
      continue;
    }
    const startsAt = asDate(block.starts_at);
    const endsAt = asDate(block.ends_at);
    if (rangesOverlap(startsAt, endsAt, dayStart, dayEnd)) {
      ranges.push({ startsAt, endsAt });
    }
  }
  return ranges;
}

function assertInsideHorizon(date: string, timeZone: string, now: Date): void {
  if (!dateOk(date)) throw new BookingRejected("invalid", "Escolha um dia da lista.");
  const today = zonedIso(now, timeZone);
  const last = addDays(today, DAY_COUNT - 1);
  if (date < today || date > last) {
    throw new BookingRejected("invalid", "Escolha um dia dos próximos 14 dias.");
  }
}

export async function listBookingDays(input: { barberSlug: string }): Promise<DayOption[]> {
  const sql = await getSql();
  const shop = await publicShop(sql);
  const barbers = await barbersForRequest(sql, shop.id, input.barberSlug);
  if (!barbers.length) throw new BookingRejected("invalid", "Escolha um barbeiro.");
  const now = new Date();
  const today = zonedIso(now, shop.timezone);
  const days: DayOption[] = [];
  for (let offset = 0; offset < DAY_COUNT; offset += 1) {
    const iso = addDays(today, offset);
    const weekday = weekdayOf(iso);
    let open = false;
    for (const barber of barbers) {
      const shifts = await shiftsFor(sql, shop.id, barber.id, weekday);
      if (shifts.length) {
        open = true;
        break;
      }
    }
    days.push({ iso, closed: !open });
  }
  return days;
}

export async function listFreeSlots(input: {
  serviceSlug: string;
  barberSlug: string;
  date: string;
}): Promise<string[]> {
  const sql = await getSql();
  const shop = await publicShop(sql);
  const now = new Date();
  assertInsideHorizon(input.date, shop.timezone, now);
  const service = await serviceForShop(sql, shop.id, input.serviceSlug);
  const barbers = await barbersForRequest(sql, shop.id, input.barberSlug);
  if (!barbers.length) throw new BookingRejected("invalid", "Escolha um barbeiro.");
  const weekday = weekdayOf(input.date);
  const groups: string[][] = [];
  for (const barber of barbers) {
    const shifts = await shiftsFor(sql, shop.id, barber.id, weekday);
    const busy = await busyFor(sql, shop.id, barber.id, input.date, shop.timezone);
    groups.push(
      freeStartTimes({
        date: input.date,
        timeZone: shop.timezone,
        durationMinutes: service.duration_minutes,
        slotMinutes: shop.slotMinutes,
        shifts,
        busy,
        now,
      }),
    );
  }
  return input.barberSlug === ANY_BARBER_SLUG ? unionFreeTimes(groups) : (groups[0] ?? []);
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code: unknown }).code) : "";
  if (code === "23505") return true;
  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  return message.includes("bookings_active_slot_uidx");
}

async function barberStillFree(
  sql: Sql,
  shop: ShopContext,
  barber: BarberRow,
  service: ServiceRow,
  date: string,
  time: string,
  now: Date,
): Promise<{ ok: true; startsAt: Date; endsAt: Date } | { ok: false; reason: "off_grid" | "busy" }> {
  const lockKey = `${shop.id}:${barber.id}:${date}`;
  await sql`select pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
  const shifts = await shiftsFor(sql, shop.id, barber.id, weekdayOf(date));
  const onGrid = freeStartTimes({
    date,
    timeZone: shop.timezone,
    durationMinutes: service.duration_minutes,
    slotMinutes: shop.slotMinutes,
    shifts,
    busy: [],
    now: new Date(0),
  });
  if (!onGrid.includes(time)) return { ok: false, reason: "off_grid" };
  const window = bookingWindow(date, time, service.duration_minutes, shop.timezone);
  if (window.startsAt.getTime() <= now.getTime()) return { ok: false, reason: "busy" };
  const bookingHits = await sql<{ id: string }>`
    select id
    from bookings
    where shop_id = ${shop.id}
      and barber_id = ${barber.id}
      and status = 'active'
      and starts_at < ${window.endsAt}
      and ends_at > ${window.startsAt}
    for update
  `;
  if (bookingHits.length) return { ok: false, reason: "busy" };
  const dayStart = bookingWindow(date, "00:00", 0, shop.timezone).startsAt;
  const dayEnd = bookingWindow(addDays(date, 1), "00:00", 0, shop.timezone).startsAt;
  const blockHits = await sql<{ id: string }>`
    select id
    from blocks
    where shop_id = ${shop.id}
      and barber_id = ${barber.id}
      and (
        (starts_at < ${window.endsAt} and ends_at > ${window.startsAt})
        or (
          all_day
          and starts_at < ${dayEnd}
          and ends_at > ${dayStart}
          and (timezone(${shop.timezone}, starts_at))::date = ${date}::date
        )
      )
    for update
  `;
  if (blockHits.length) return { ok: false, reason: "busy" };
  return { ok: true, startsAt: window.startsAt, endsAt: window.endsAt };
}

export async function confirmBooking(input: ConfirmInput, ip: string): Promise<ConfirmResult> {
  if (!(await allowBookingAttempt(ip))) {
    throw new BookingRejected("rate_limited", RATE_LIMIT_MESSAGE);
  }
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new BookingRejected("invalid", "Informe seu nome.");
  }
  const phone = parseBrazilianPhone(input.phone);
  if (!phone.ok) throw new BookingRejected("invalid", phone.message);
  if (!dateOk(input.date) || !timeOk(input.time)) {
    throw new BookingRejected("invalid", "Escolha um dia e um horário.");
  }

  let saved: { result: ConfirmResult; notice: BookingNotice };
  try {
    saved = await withTransaction(async (sql) => {
      const shop = await publicShop(sql);
      const now = new Date();
      assertInsideHorizon(input.date, shop.timezone, now);
      const service = await serviceForShop(sql, shop.id, input.serviceSlug);
      const barbers = await barbersForRequest(sql, shop.id, input.barberSlug);
      if (!barbers.length) throw new BookingRejected("invalid", "Escolha um barbeiro.");

      let sawBusy = false;
      for (const barber of barbers) {
        const decision = await barberStillFree(sql, shop, barber, service, input.date, input.time, now);
        if (!decision.ok) {
          if (decision.reason === "busy") sawBusy = true;
          if (input.barberSlug !== ANY_BARBER_SLUG) break;
          continue;
        }
        try {
          await sql`savepoint slot_insert`;
          await sql`
            insert into bookings (
              shop_id, barber_id, service_id, customer_name, customer_phone,
              starts_at, ends_at, status
            ) values (
              ${shop.id},
              ${barber.id},
              ${service.id},
              ${name},
              ${phone.digits},
              ${decision.startsAt},
              ${decision.endsAt},
              'active'
            )
          `;
          await sql`release savepoint slot_insert`;
        } catch (err) {
          if (isUniqueViolation(err)) {
            await sql`rollback to savepoint slot_insert`;
            sawBusy = true;
            if (input.barberSlug !== ANY_BARBER_SLUG) break;
            continue;
          }
          throw err;
        }
        const priced = priceLabel(Number(service.price_cents));
        const label = dayLabel(input.date);
        const time = clockLabel(input.time);
        const message = waMessage(service.name, barber.name, label, time, name);
        const waUrl = await shopWhatsAppLink(sql, shop.id, message);
        return {
          result: {
            serviceName: service.name,
            barberName: barber.name,
            dayLabel: label,
            time,
            priceLabel: priced,
            waUrl,
            waNotice: waUrl ? null : NO_SHOP_WHATSAPP,
          },
          notice: {
            shopId: shop.id,
            serviceName: service.name,
            barberName: barber.name,
            date: input.date,
            time,
            customerName: name,
            customerPhone: phone.digits,
            priceLabel: priced,
          },
        };
      }
      if (!sawBusy) {
        throw new BookingRejected("invalid", "Escolha um horário da lista.");
      }
      throw new BookingRejected(
        "slot_taken",
        "Esse horário acabou de ser ocupado. Escolha outro, por favor.",
      );
    });
  } catch (err) {
    if (err instanceof BookingRejected) throw err;
    console.error("[booking] confirm failed:", err);
    throw new BookingRejected("unavailable", "Não foi possível concluir o agendamento. Tente de novo.");
  }

  try {
    await notifyNewBooking(saved.notice);
  } catch (err) {
    const text = err instanceof Error ? err.message : "unknown";
    console.error(
      "[notify] new booking notice failed:",
      text.replace(/re_[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300),
    );
  }
  return saved.result;
}
