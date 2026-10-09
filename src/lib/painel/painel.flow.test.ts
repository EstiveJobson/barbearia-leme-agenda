import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { getSql } from "@/lib/db";
import { confirmBooking, listFreeSlots } from "@/lib/agenda/booking.server";
import { resetBookingRateLimit } from "@/lib/agenda/rate-limit";
import { loadOwner, loginWithPassword } from "@/lib/painel/auth.server";
import { cancelBooking, createBlock, loadAgenda, removeBlock } from "@/lib/painel/agenda.server";
import {
  OWNER_COOKIE_MAX_AGE,
  OWNER_COOKIE_OPTIONS,
  openOwnerSession,
  sealOwnerSession,
} from "@/lib/painel/session";

const SECRET = "painel-test-secret";
process.env.SESSION_SECRET = SECRET;
const PASSWORD = "senha-painel-teste";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function bahiaIso(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bahia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function weekday(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1)).getUTCDay();
}

/** Next open Leme day inside the public 14-day window. */
function nextOpenIso(now: Date): string {
  const today = bahiaIso(now);
  for (let offset = 1; offset <= 13; offset += 1) {
    const iso = addDays(today, offset);
    const day = weekday(iso);
    if (day !== 0 && day !== 1) return iso;
  }
  throw new Error("no open day in range");
}

async function ensureOwners() {
  const sql = await getSql();
  const lemeHash = await bcrypt.hash(PASSWORD, 4);
  const otherHash = await bcrypt.hash("outra-senha-teste", 4);
  await sql`
    insert into owner_accounts (shop_id, password_hash)
    select id, ${lemeHash} from shops where slug = ${"barbearia-leme"}
    on conflict (shop_id) do update set password_hash = excluded.password_hash
  `;
  await sql`
    insert into owner_accounts (shop_id, password_hash)
    select id, ${otherHash} from shops where slug = ${"barbearia-teste"}
    on conflict (shop_id) do update set password_hash = excluded.password_hash
  `;
  const rows = await sql<{ id: string; shop_id: string; slug: string }>`
    select o.id, o.shop_id, s.slug
    from owner_accounts o
    join shops s on s.id = o.shop_id
    where s.slug = ${"barbearia-leme"}
  `;
  const owner = rows[0];
  assert.ok(owner);
  return owner;
}

test("session cookie is signed, expires, and stores only the owner id", () => {
  assert.equal(OWNER_COOKIE_OPTIONS.httpOnly, true);
  assert.equal(OWNER_COOKIE_OPTIONS.secure, true);
  assert.equal(OWNER_COOKIE_OPTIONS.sameSite, "lax");
  assert.equal(OWNER_COOKIE_OPTIONS.path, "/");
  assert.equal(OWNER_COOKIE_OPTIONS.maxAge, 30 * 24 * 60 * 60);
  assert.equal(OWNER_COOKIE_MAX_AGE, OWNER_COOKIE_OPTIONS.maxAge);

  const ownerId = "11111111-1111-4111-8111-111111111111";
  const token = sealOwnerSession(ownerId, SECRET);
  assert.ok(token);
  assert.equal(token.includes(PASSWORD), false);
  assert.equal(openOwnerSession(token, SECRET), ownerId);
  const payload = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as {
    sub: string;
    exp: number;
  };
  assert.deepEqual(Object.keys(payload).sort(), ["exp", "sub"]);
  assert.equal(openOwnerSession(`${token}x`, SECRET), null);
  assert.equal(openOwnerSession(token, "other-secret"), null);
  const expired = sealOwnerSession(ownerId, SECRET, Date.now() - 31 * 24 * 60 * 60 * 1000);
  assert.equal(openOwnerSession(expired ?? "", SECRET), null);
});

test("login checks the owner hash and the panel only sees that shop", async () => {
  await resetBookingRateLimit();
  const account = await ensureOwners();
  const wrong = await loginWithPassword("nao-e-a-senha", "ip-login-wrong");
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.code, "invalid");

  const logged = await loginWithPassword(PASSWORD, "ip-login-ok");
  assert.equal(logged.ok, true);
  if (!logged.ok) return;
  assert.equal(logged.token.includes(PASSWORD), false);
  const ownerId = openOwnerSession(logged.token, SECRET);
  assert.equal(ownerId, account.id);
  const owner = await loadOwner(ownerId ?? "");
  assert.equal(owner?.shopId, account.shop_id);

  const sql = await getSql();
  const barbers = await sql<{ id: string; shop_id: string }>`
    select b.id, b.shop_id
    from barbers b
    join shops s on s.id = b.shop_id
    where s.slug = ${"barbearia-teste"} and b.slug = ${"ana"}
  `;
  const otherBarber = barbers[0];
  assert.ok(owner && otherBarber);
  const foreign = await loadAgenda(owner, { view: "today", barberId: otherBarber.id, includeCancelled: false });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.status, 404);

  const blocked = await createBlock(owner, {
    barberId: otherBarber.id,
    date: "2026-10-13",
    allDay: true,
    start: "",
    end: "",
    reason: "",
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.status, 404);
});

test("cancel and block stay inside the session shop and free the public slot", async () => {
  await resetBookingRateLimit();
  const account = await ensureOwners();
  const owner = await loadOwner(account.id);
  assert.ok(owner);
  const when = nextOpenIso(new Date());
  const saved = await confirmBooking(
    {
      serviceSlug: "corte",
      barberSlug: "rafael",
      date: when,
      time: "10:00",
      name: "Cliente Painel",
      phone: "(71) 98888-7777",
    },
    "ip-painel-book",
  );
  assert.equal(saved.barberName, "Rafael Lima");

  const day = await loadAgenda(owner, { view: "today", barberId: null, includeCancelled: false }, new Date(`${when}T15:00:00Z`));
  assert.equal(day.ok, true);
  if (!day.ok) return;
  const card = day.data.days.flatMap((item) => item.bookings).find((item) => item.customerName === "Cliente Painel");
  assert.ok(card);
  assert.equal(card.waUrl, "https://wa.me/5571988887777");
  assert.equal(card.serviceName, "Corte");
  assert.equal(card.startLabel, "10:00");

  const sql = await getSql();
  const other = await sql<{ barber_id: string; service_id: string; shop_id: string }>`
    select b.id as barber_id, s.id as service_id, sh.id as shop_id
    from barbers b
    join shops sh on sh.id = b.shop_id
    join services s on s.shop_id = sh.id and s.slug = ${"corte"}
    where sh.slug = ${"barbearia-teste"} and b.slug = ${"ana"}
  `;
  const foreignShop = other[0];
  assert.ok(foreignShop);
  const inserted = await sql<{ id: string }>`
    insert into bookings (
      shop_id, barber_id, service_id, customer_name, customer_phone, starts_at, ends_at, status
    ) values (
      ${foreignShop.shop_id},
      ${foreignShop.barber_id},
      ${foreignShop.service_id},
      ${"Cliente de outra loja"},
      ${"92988887777"},
      ${new Date(`${when}T15:00:00Z`)},
      ${new Date(`${when}T16:00:00Z`)},
      'active'
    )
    returning id
  `;
  const foreignId = inserted[0]?.id ?? "";
  const hidden = await cancelBooking(owner, foreignId);
  assert.equal(hidden.ok, false);
  if (!hidden.ok) assert.equal(hidden.status, 404);
  const still = await sql<{ status: string }>`select status from bookings where id = ${foreignId}`;
  assert.equal(still[0]?.status, "active");

  const listed = await loadAgenda(owner, { view: "today", barberId: null, includeCancelled: true }, new Date(`${when}T15:00:00Z`));
  assert.equal(listed.ok, true);
  if (listed.ok) {
    assert.equal(
      listed.data.days.some((item) => item.bookings.some((booking) => booking.customerName === "Cliente de outra loja")),
      false,
    );
  }

  const taken = await listFreeSlots({ serviceSlug: "corte", barberSlug: "rafael", date: when });
  assert.equal(taken.includes("10:00"), false);
  assert.equal(await cancelBooking(owner, card.id).then((result) => result.ok), true);
  const freed = await listFreeSlots({ serviceSlug: "corte", barberSlug: "rafael", date: when });
  assert.equal(freed.includes("10:00"), true);
  const hiddenCancelled = await loadAgenda(owner, { view: "today", barberId: null, includeCancelled: false }, new Date(`${when}T15:00:00Z`));
  if (hiddenCancelled.ok) {
    assert.equal(
      hiddenCancelled.data.days.some((item) => item.bookings.some((booking) => booking.id === card.id)),
      false,
    );
  }

  const rafael = await sql<{ id: string }>`
    select b.id from barbers b
    join shops s on s.id = b.shop_id
    where s.slug = ${"barbearia-leme"} and b.slug = ${"rafael"}
  `;
  const created = await createBlock(owner, {
    barberId: rafael[0]?.id ?? "",
    date: when,
    allDay: false,
    start: "15:00",
    end: "17:00",
    reason: "Fornecedor",
  });
  assert.equal(created.ok, true);
  const during = await listFreeSlots({ serviceSlug: "corte", barberSlug: "rafael", date: when });
  assert.equal(during.includes("15:00"), false);
  const withBlock = await loadAgenda(owner, { view: "today", barberId: null, includeCancelled: false }, new Date(`${when}T15:00:00Z`));
  assert.equal(withBlock.ok, true);
  const blockId = withBlock.ok
    ? withBlock.data.days.flatMap((item) => item.blocks).find((item) => item.reason === "Fornecedor")?.id
    : "";
  assert.ok(blockId);
  assert.equal(await removeBlock(owner, foreignId).then((result) => result.ok), false);
  assert.equal((await removeBlock(owner, blockId ?? "")).ok, true);
  const after = await listFreeSlots({ serviceSlug: "corte", barberSlug: "rafael", date: when });
  assert.equal(after.includes("15:00"), true);
});

test("login attempts are rate-limited per IP", async () => {
  await resetBookingRateLimit();
  await ensureOwners();
  for (let i = 0; i < 8; i += 1) {
    const result = await loginWithPassword("errada", "ip-painel-spam");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid");
  }
  const limited = await loginWithPassword(PASSWORD, "ip-painel-spam");
  assert.equal(limited.ok, false);
  if (!limited.ok) assert.equal(limited.code, "rate_limited");
  const otherIp = await loginWithPassword(PASSWORD, "ip-painel-ok-2");
  assert.equal(otherIp.ok, true);
});
