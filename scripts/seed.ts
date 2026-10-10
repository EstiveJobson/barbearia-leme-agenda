#!/usr/bin/env node
/**
 * Seed Barbearia Leme plus a second fictional shop used only for
 * tenant-isolation tests.
 *
 * With DATABASE_URL, writes to Neon Postgres. Without it, applies migrations
 * and seeds the local PGLite fallback (in-memory for this process).
 *
 * Owner password hashes are derived from ADMIN_PASSWORD at runtime. The same
 * password is stored for both shops' owner accounts (one row each). The plain
 * password is never written to the database or the repo.
 *
 * Re-running updates shop profiles, catalog rows, weekly hours, and password
 * hashes. It does not delete bookings.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import pg from "pg";
import { lemeCatalog, testShopCatalog, type CatalogShop } from "../src/lib/agenda/catalog.ts";
import { pendingMigrations } from "./migration-plan.mjs";

type QueryResult = { rows: Array<Record<string, unknown>> };

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<QueryResult>;
};

const databaseUrl = process.env.DATABASE_URL?.trim();
const adminPassword = process.env.ADMIN_PASSWORD ?? "";

async function upsertShop(client: Queryable, shop: CatalogShop, passwordHash: string) {
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
  const shopId = shopRow.rows[0]?.id;
  if (typeof shopId !== "string" || !shopId) {
    throw new Error(`Failed to seed shop ${shop.slug}`);
  }

  for (let i = 0; i < shop.barbers.length; i += 1) {
    const barber = shop.barbers[i];
    if (!barber) continue;
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
    if (!service) continue;
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

  const barberIds = await client.query("select id, slug from barbers where shop_id = $1", [shopId]);
  await client.query("delete from weekly_schedule where shop_id = $1", [shopId]);
  for (const barber of barberIds.rows) {
    const barberId = barber.id;
    if (typeof barberId !== "string") continue;
    for (const hours of shop.hours) {
      await client.query(
        `insert into weekly_schedule (shop_id, barber_id, weekday, start_time, end_time)
         values ($1,$2,$3,$4,$5)`,
        [shopId, barberId, hours.weekday, hours.start, hours.end],
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

async function seedBoth(client: Queryable, passwordHash: string) {
  await upsertShop(client, lemeCatalog(), passwordHash);
  await upsertShop(client, testShopCatalog(), passwordHash);
}

async function seedNeon(passwordHash: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await seedBoth(client, passwordHash);
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

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function seedPglite(passwordHash: string) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.waitReady;
  try {
    let entries: string[] = [];
    try {
      entries = await readdir(migrationsDir);
    } catch {
      entries = [];
    }
    await db.exec(
      "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const appliedResult = await db.query<{ name: string }>("select name from _migrations");
    const applied = appliedResult.rows.map((row) => row.name);
    for (const { name } of pendingMigrations(entries, applied)) {
      const text = await readFile(join(migrationsDir, name), "utf8");
      await db.transaction(async (tx) => {
        await tx.exec(text);
        await tx.query("insert into _migrations (name) values ($1)", [name]);
      });
      console.log(`[seed] applied ${name}`);
    }

    await db.transaction(async (tx) => {
      await seedBoth(
        {
          query: async (text, params) => tx.query(text, params ?? []),
        },
        passwordHash,
      );
    });

    const shops = await db.query<{ slug: string }>("select slug from shops order by slug");
    const slugs = shops.rows.map((row) => row.slug).sort();
    if (slugs.join() !== "barbearia-leme,barbearia-teste") {
      throw new Error(`[seed] PGLite fallback missing shops: ${slugs.join(", ") || "(none)"}`);
    }
    console.log("[seed] done — both shops use the ADMIN_PASSWORD hash.");
  } finally {
    await db.close();
  }
}

async function main() {
  if (!adminPassword.trim()) {
    console.error(
      "[seed] ADMIN_PASSWORD is required so owner_accounts.password_hash can be created. Do not commit the password.",
    );
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  if (databaseUrl) {
    await seedNeon(passwordHash);
    return;
  }
  console.log("[seed] DATABASE_URL not set — seeding the local PGLite fallback.");
  await seedPglite(passwordHash);
}

main().catch((err: { message?: string }) => {
  console.error("[seed] failed:", err?.message || err);
  process.exit(1);
});
