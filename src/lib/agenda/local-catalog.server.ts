import bcrypt from "bcryptjs";
import { lemeCatalog, testShopCatalog, type CatalogShop } from "@/lib/agenda/catalog";

type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

async function upsertShop(query: Query, shop: CatalogShop, passwordHash: string | null) {
  const shopRows = await query<{ id: string }>(
    `insert into shops (
       slug, name, timezone, tagline, intro, city_line, seo_description,
       whatsapp, instagram, address, map_query, slot_minutes, year
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (slug) do update set
       name = excluded.name,
       timezone = excluded.timezone,
       tagline = excluded.tagline,
       intro = excluded.intro,
       city_line = excluded.city_line,
       seo_description = excluded.seo_description,
       whatsapp = excluded.whatsapp,
       instagram = excluded.instagram,
       address = excluded.address,
       map_query = excluded.map_query,
       slot_minutes = excluded.slot_minutes,
       year = excluded.year
     returning id`,
    [
      shop.slug,
      shop.name,
      shop.timezone,
      shop.tagline,
      shop.intro,
      shop.cityLine,
      shop.seoDescription,
      shop.whatsapp,
      shop.instagram,
      shop.address,
      shop.mapQuery,
      shop.slotMinutes,
      shop.year,
    ],
  );
  const shopId = shopRows[0]?.id;
  if (!shopId) throw new Error(`Failed to seed shop ${shop.slug}`);

  for (let i = 0; i < shop.barbers.length; i += 1) {
    const barber = shop.barbers[i];
    if (!barber) continue;
    await query(
      `insert into barbers (shop_id, slug, name, specialty, photo, sort_order)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (shop_id, slug) do update set
         name = excluded.name,
         specialty = excluded.specialty,
         photo = excluded.photo,
         sort_order = excluded.sort_order`,
      [shopId, barber.slug, barber.name, barber.specialty, barber.photo, i],
    );
  }

  for (let i = 0; i < shop.services.length; i += 1) {
    const service = shop.services[i];
    if (!service) continue;
    await query(
      `insert into services (
         shop_id, slug, name, description, price_cents, duration_minutes, sort_order
       ) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (shop_id, slug) do update set
         name = excluded.name,
         description = excluded.description,
         price_cents = excluded.price_cents,
         duration_minutes = excluded.duration_minutes,
         sort_order = excluded.sort_order`,
      [
        shopId,
        service.slug,
        service.name,
        service.description,
        Math.round(service.price * 100),
        service.duration,
        i,
      ],
    );
  }

  const barberIds = await query<{ id: string }>("select id from barbers where shop_id = $1", [shopId]);
  await query("delete from weekly_schedule where shop_id = $1", [shopId]);
  for (const barber of barberIds) {
    for (const hours of shop.hours) {
      await query(
        `insert into weekly_schedule (shop_id, barber_id, weekday, start_time, end_time)
         values ($1,$2,$3,$4,$5)`,
        [shopId, barber.id, hours.weekday, hours.start, hours.end],
      );
    }
  }

  if (passwordHash) {
    await query(
      `insert into owner_accounts (shop_id, password_hash)
       values ($1, $2)
       on conflict (shop_id) do update set password_hash = excluded.password_hash`,
      [shopId, passwordHash],
    );
  }
}

/**
 * Local PGLite starts empty. Seed both shops once so the public booking flow
 * works without Neon. Production never calls this.
 */
export async function seedLocalCatalogIfEmpty(query: Query): Promise<void> {
  const existing = await query<{ n: number }>("select count(*)::int as n from shops");
  if (Number(existing[0]?.n ?? 0) > 0) return;
  const password = process.env.ADMIN_PASSWORD?.trim();
  const passwordHash = password ? await bcrypt.hash(password, 12) : null;
  await upsertShop(query, lemeCatalog(), passwordHash);
  await upsertShop(query, testShopCatalog(), passwordHash);
}
