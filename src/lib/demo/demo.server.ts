import { createHash, timingSafeEqual } from "node:crypto";
import { getSql, withTransaction, type Sql } from "@/lib/db";
import { zonedSlotToUtc } from "@/lib/agenda/time";
import { buildDemoSample, type DemoPlan } from "@/lib/demo/sample";

const DEMO_SHOPS = ["barbearia-leme", "barbearia-teste"] as const;
const PUBLIC_SLUG = "barbearia-leme";
const LOCK = "demo-agenda";

function readEnv(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function isDemoMode(): boolean {
  return readEnv("DEMO_MODE") === "true";
}

function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

/** True only for `Authorization: Bearer <CRON_SECRET>`. Empty secret never matches. */
export function cronAuthorized(header: string | null): boolean {
  const secret = readEnv("CRON_SECRET");
  if (!secret || !header) return false;
  return safeEqual(header, `Bearer ${secret}`);
}

function logError(label: string, err: unknown): void {
  let text = err instanceof Error ? err.message : "unknown";
  for (const name of ["CRON_SECRET", "SESSION_SECRET", "RESEND_API_KEY", "DATABASE_URL", "ADMIN_PASSWORD", "VAPID_PRIVATE_KEY"]) {
    const secret = readEnv(name);
    if (secret) text = text.split(secret).join("[redacted]");
  }
  console.error(label, text.slice(0, 300));
}

function bahiaToday(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bahia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function hhmm(value: unknown): string {
  const match = /^(\d{2}):(\d{2})/.exec(String(value));
  return match ? `${match[1]}:${match[2]}` : "00:00";
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

async function writeDemoAgenda(sql: Sql, now: Date): Promise<{ bookings: number; blocks: number }> {
  await sql`
    delete from bookings
    where shop_id in (select id from shops where slug in (${DEMO_SHOPS[0]}, ${DEMO_SHOPS[1]}))
  `;
  await sql`
    delete from blocks
    where shop_id in (select id from shops where slug in (${DEMO_SHOPS[0]}, ${DEMO_SHOPS[1]}))
  `;

  const shops = await sql<{ id: string; timezone: string; slot_minutes: number }>`
    select id, timezone, slot_minutes from shops where slug = ${PUBLIC_SLUG} limit 1
  `;
  const shop = shops[0];
  if (!shop) return { bookings: 0, blocks: 0 };

  const barbers = await sql<{ id: string; slug: string }>`
    select id, slug from barbers where shop_id = ${shop.id} order by sort_order, name
  `;
  const services = await sql<{ id: string; slug: string; duration_minutes: number }>`
    select id, slug, duration_minutes from services where shop_id = ${shop.id}
  `;
  const shifts = await sql<{ barber_slug: string; weekday: number; start_time: unknown; end_time: unknown }>`
    select b.slug as barber_slug, w.weekday, w.start_time, w.end_time
    from weekly_schedule w
    join barbers b on b.id = w.barber_id
    where w.shop_id = ${shop.id}
  `;

  const plan: DemoPlan = buildDemoSample({
    today: bahiaToday(now),
    slotMinutes: shop.slot_minutes,
    barbers: barbers.map((barber) => ({ slug: barber.slug })),
    services: services.map((service) => ({ slug: service.slug, duration: service.duration_minutes })),
    shifts: shifts.map((shift) => ({
      barberSlug: shift.barber_slug,
      weekday: Number(shift.weekday),
      start: hhmm(shift.start_time),
      end: hhmm(shift.end_time),
    })),
  });

  const barberId = new Map(barbers.map((barber) => [barber.slug, barber.id]));
  const serviceId = new Map(services.map((service) => [service.slug, service.id]));
  let bookings = 0;
  for (const booking of plan.bookings) {
    const barber = barberId.get(booking.barberSlug);
    const service = serviceId.get(booking.serviceSlug);
    if (!barber || !service) continue;
    const startsAt = zonedSlotToUtc(booking.date, booking.time, shop.timezone);
    const endsAt = new Date(startsAt.getTime() + booking.duration * 60_000);
    await sql`
      insert into bookings (
        shop_id, barber_id, service_id, customer_name, customer_phone, starts_at, ends_at, status
      ) values (
        ${shop.id},
        ${barber},
        ${service},
        ${booking.name},
        ${booking.phone},
        ${startsAt},
        ${endsAt},
        ${booking.status}
      )
    `;
    bookings += 1;
  }

  let blocks = 0;
  for (const block of plan.blocks) {
    const barber = barberId.get(block.barberSlug);
    if (!barber) continue;
    const startsAt = zonedSlotToUtc(block.date, block.allDay ? "00:00" : block.start, shop.timezone);
    const endsAt = block.allDay
      ? zonedSlotToUtc(addDays(block.date, 1), "00:00", shop.timezone)
      : zonedSlotToUtc(block.date, block.end, shop.timezone);
    await sql`
      insert into blocks (shop_id, barber_id, starts_at, ends_at, all_day, reason)
      values (${shop.id}, ${barber}, ${startsAt}, ${endsAt}, ${block.allDay}, ${block.reason})
    `;
    blocks += 1;
  }
  return { bookings, blocks };
}

async function locked<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  return withTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext(${LOCK})::bigint)`;
    return run(sql);
  });
}

/** Fill Leme only when demo mode is on and that shop has no bookings yet. */
export async function maybeSeedDemoAgenda(now = new Date()): Promise<void> {
  if (!isDemoMode()) return;
  try {
    await locked(async (sql) => {
      const rows = await sql<{ n: number }>`
        select count(*)::int as n
        from bookings b
        join shops s on s.id = b.shop_id
        where s.slug = ${PUBLIC_SLUG}
      `;
      if (Number(rows[0]?.n ?? 0) > 0) return;
      await writeDemoAgenda(sql, now);
    });
  } catch (err) {
    logError("[demo] seed skipped:", err);
  }
}

/** Delete demo-shop bookings and blocks, then reload Leme's sample agenda. */
export async function resetDemoAgenda(now = new Date()): Promise<{ bookings: number; blocks: number }> {
  const result = await locked((sql) => writeDemoAgenda(sql, now));
  console.info(`[demo] agenda reset: ${result.bookings} bookings, ${result.blocks} blocks`);
  return result;
}

export async function handleDemoReset(request: Request): Promise<Response> {
  if (!isDemoMode()) return new Response(null, { status: 404 });
  if (!cronAuthorized(request.headers.get("authorization"))) {
    console.error("[demo] reset rejected");
    return new Response(null, { status: 401 });
  }
  try {
    const result = await resetDemoAgenda(new Date());
    return Response.json({ ok: true, bookings: result.bookings, blocks: result.blocks });
  } catch (err) {
    logError("[demo] reset failed:", err);
    return new Response(null, { status: 500 });
  }
}
