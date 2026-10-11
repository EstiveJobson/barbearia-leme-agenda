import { zonedSlotToUtc } from "@/lib/agenda/time";
import { buildDemoSample, type DemoPlan } from "@/lib/demo/sample";

/** Tagged SQL only. Kept off `@/lib/db` so `tsx scripts/seed.ts` can call it. */
export type TaggedSql = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

type DemoShop = { id: string; timezone: string; slot_minutes: number };

function zonedToday(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
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

async function fillShop(sql: TaggedSql, shop: DemoShop, now: Date): Promise<{ bookings: number; blocks: number }> {
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
    today: zonedToday(now, shop.timezone),
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

async function demoShops(sql: TaggedSql): Promise<Array<DemoShop & { n: number }>> {
  return sql<DemoShop & { n: number }>`
    select s.id, s.timezone, s.slot_minutes,
           (select count(*)::int from bookings b where b.shop_id = s.id) as n
    from shops s
    where s.is_demo = true
    order by s.slug
  `;
}

/** Insert sample rows for demo shops that have no bookings. Does not delete anything. */
export async function insertDemoSampleIfEmpty(
  sql: TaggedSql,
  now = new Date(),
): Promise<{ bookings: number; blocks: number }> {
  let bookings = 0;
  let blocks = 0;
  for (const shop of await demoShops(sql)) {
    if (Number(shop.n) > 0) continue;
    const filled = await fillShop(sql, shop, now);
    bookings += filled.bookings;
    blocks += filled.blocks;
  }
  return { bookings, blocks };
}

/** Wipe bookings, blocks, and push subscriptions for every is_demo shop, then refill them. */
export async function writeDemoAgenda(sql: TaggedSql, now = new Date()): Promise<{ bookings: number; blocks: number }> {
  await sql`
    delete from push_subscriptions
    where shop_id in (select id from shops where is_demo = true)
  `;
  await sql`
    delete from bookings
    where shop_id in (select id from shops where is_demo = true)
  `;
  await sql`
    delete from blocks
    where shop_id in (select id from shops where is_demo = true)
  `;

  let bookings = 0;
  let blocks = 0;
  for (const shop of await demoShops(sql)) {
    const filled = await fillShop(sql, shop, now);
    bookings += filled.bookings;
    blocks += filled.blocks;
  }
  return { bookings, blocks };
}
