#!/usr/bin/env node
/**
 * Seed Neon Postgres (DATABASE_URL) with Barbearia Leme plus a second fictional
 * shop used only for tenant-isolation tests.
 *
 * Owner password hashes are derived from ADMIN_PASSWORD at runtime. The same
 * password is stored for both shops' owner accounts (one row each). The plain
 * password is never written to the database or the repo.
 *
 * Re-running updates shop profiles, catalog rows, weekly hours, and password
 * hashes. It does not delete bookings.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import { lemeCatalog, testShopCatalog } from "../src/lib/agenda/catalog.ts";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(
    "[seed] DATABASE_URL is required. This script seeds Neon Postgres and does not use the local PGLite fallback.",
  );
  process.exit(1);
}

const adminPassword = process.env.ADMIN_PASSWORD ?? "";
if (!adminPassword.trim()) {
  console.error(
    "[seed] ADMIN_PASSWORD is required so owner_accounts.password_hash can be created. Do not commit the password.",
  );
  process.exit(1);
}

/**
 * @param {import("pg").PoolClient} client
 * @param {ReturnType<typeof lemeCatalog>} shop
 * @param {string} passwordHash
 */
async function upsertShop(client, shop, passwordHash) {
  const shopRow = await client.query(
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
  const shopId = shopRow.rows[0].id;

  for (let i = 0; i < shop.barbers.length; i += 1) {
    const barber = shop.barbers[i];
    await client.query(
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
    await client.query(
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

  const barberIds = await client.query(
    "select id, slug from barbers where shop_id = $1",
    [shopId],
  );
  await client.query("delete from weekly_schedule where shop_id = $1", [shopId]);
  for (const barber of barberIds.rows) {
    for (const hours of shop.hours) {
      await client.query(
        `insert into weekly_schedule (shop_id, barber_id, weekday, start_time, end_time)
         values ($1,$2,$3,$4,$5)`,
        [shopId, barber.id, hours.weekday, hours.start, hours.end],
      );
    }
  }

  await client.query(
    `insert into owner_accounts (shop_id, password_hash)
     values ($1, $2)
     on conflict (shop_id) do update set password_hash = excluded.password_hash`,
    [shopId, passwordHash],
  );

  console.log(`[seed] ${shop.slug} (${shopId})`);
}

async function main() {
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await upsertShop(client, lemeCatalog(), passwordHash);
    await upsertShop(client, testShopCatalog(), passwordHash);
    await client.query("commit");
    console.log("[seed] done — both shops use the ADMIN_PASSWORD hash.");
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // Keep the original error when the connection is already dead.
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[seed] failed:", err?.message || err);
  process.exit(1);
});
