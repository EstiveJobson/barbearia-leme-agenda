import { getSql, type Sql } from "@/lib/db";
import { bookingWindow } from "@/lib/agenda/time";

/**
 * Slug of the shop rendered by this public site.
 * Resolved on the server. Never accept a shop id from the browser.
 */
export const PUBLIC_SHOP_SLUG = "barbearia-leme";

export type ShopRow = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  slot_minutes: number;
};

async function oneShop(sql: Sql, slug: string): Promise<ShopRow> {
  const rows = await sql<ShopRow>`
    select id, slug, name, timezone, slot_minutes
    from shops
    where slug = ${slug}
    limit 1
  `;
  const shop = rows[0];
  if (!shop) {
    throw new Error(`Shop "${slug}" is not in the database. Run npm run db:seed.`);
  }
  return shop;
}

/** The shop behind the public site. The slug is a server constant. */
export async function getPublicShop(): Promise<ShopRow> {
  const sql = await getSql();
  return oneShop(sql, PUBLIC_SHOP_SLUG);
}

/**
 * Catalog for one shop. `shopId` must already have been resolved on the server
 * (public site or the owner session). Every business query filters by it.
 */
export async function listShopServices(shopId: string) {
  const sql = await getSql();
  return sql`
    select id, slug, name, description, price_cents, duration_minutes
    from services
    where shop_id = ${shopId}
    order by sort_order, name
  `;
}

export async function listShopBarbers(shopId: string) {
  const sql = await getSql();
  return sql`
    select id, slug, name, specialty, photo
    from barbers
    where shop_id = ${shopId}
    order by sort_order, name
  `;
}

/** Weekly hours for one barber, scoped to the server-resolved shop. */
export async function listBarberSchedule(shopId: string, barberId: string) {
  const sql = await getSql();
  return sql`
    select weekday, start_time, end_time
    from weekly_schedule
    where shop_id = ${shopId} and barber_id = ${barberId}
    order by weekday
  `;
}

/**
 * UTC window for a slot. The timezone is loaded from `shops`, not from the client,
 * and the lookup is filtered by the server-resolved shop id.
 */
export async function slotWindowForShop(
  shopId: string,
  date: string,
  time: string,
  durationMinutes: number,
) {
  const sql = await getSql();
  const rows = await sql<{ timezone: string }>`
    select timezone from shops where id = ${shopId} limit 1
  `;
  const timezone = rows[0]?.timezone;
  if (!timezone) throw new Error("Shop not found");
  return bookingWindow(date, time, durationMinutes, timezone);
}
