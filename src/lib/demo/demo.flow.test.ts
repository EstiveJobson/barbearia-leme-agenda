import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { shop } from "@/shop-config";
import { getSql } from "@/lib/db";
import { resetBookingRateLimit } from "@/lib/agenda/rate-limit";
import { activeFillRatio, buildDemoSample, type DemoInput } from "@/lib/demo/sample";
import { handleDemoReset, isDemoMode, maybeSeedDemoAgenda } from "@/lib/demo/demo.server";
import { notifyNewBooking, savePushSubscription } from "@/lib/agenda/notify.server";
import { loadOwner, loginDemoOwner, loginWithPassword } from "@/lib/painel/auth.server";
import { DEMO_PUSH_DISABLED, panelLoginRedirect } from "@/lib/painel/gate";
import {
  agendaForToken,
  blockForToken,
  cancelForToken,
  pushSetupForToken,
  removeBlockForToken,
  savePushForToken,
} from "@/lib/painel/panel-api.server";
import { openOwnerSession, sealOwnerSession } from "@/lib/painel/session";

const SECRET = "painel-test-secret";
const CRON = "cron-test-secret";
const PASSWORD = "senha-painel-teste";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function lemeInput(today: string): DemoInput {
  const shifts: DemoInput["shifts"] = [];
  for (const barber of shop.barbers) {
    for (const day of shop.hours) {
      if (day.closed) continue;
      shifts.push({ barberSlug: barber.id, weekday: day.day, start: day.open, end: day.close });
    }
  }
  return {
    today,
    slotMinutes: shop.slotMinutes,
    barbers: shop.barbers.map((barber) => ({ slug: barber.id })),
    services: shop.services.map((service) => ({ slug: service.id, duration: service.duration })),
    shifts,
  };
}

function overlaps(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && end > otherStart;
}

function minutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

test("sample agenda stays inside the window and fills about half the grid", () => {
  for (const today of ["2026-10-09", "2026-01-04", "2026-08-16"]) {
    const input = lemeInput(today);
    const plan = buildDemoSample(input);
    const ratio = activeFillRatio(plan, input);
    assert.ok(ratio >= 0.4 && ratio <= 0.6, `${today} fill ${ratio}`);
    assert.ok(plan.blocks.length >= 1 && plan.blocks.length <= 2);
    const cancelled = plan.bookings.filter((booking) => booking.status === "cancelled");
    assert.ok(cancelled.length >= 1 && cancelled.length <= 5);
    const active = plan.bookings.filter((booking) => booking.status === "active");
    assert.ok(active.length > 0);
    const min = addDays(today, -3);
    const max = addDays(today, 7);
    const seen = new Set<string>();
    for (const booking of plan.bookings) {
      assert.ok(booking.date >= min && booking.date <= max);
      assert.match(booking.phone, /^719\d{8}$/);
      assert.match(booking.name, /Demo/);
      if (booking.status !== "active") continue;
      const key = `${booking.barberSlug}|${booking.date}|${booking.time}`;
      assert.equal(seen.has(key), false);
      seen.add(key);
    }
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const left = active[i];
        const right = active[j];
        if (!left || !right || left.barberSlug !== right.barberSlug || left.date !== right.date) continue;
        assert.equal(
          overlaps(minutes(left.time), minutes(left.time) + left.duration, minutes(right.time), minutes(right.time) + right.duration),
          false,
        );
      }
    }
    for (const barber of input.barbers) {
      assert.equal(active.some((booking) => booking.barberSlug === barber.slug), true, barber.slug);
    }
    for (const service of input.services) {
      assert.equal(active.some((booking) => booking.serviceSlug === service.slug), true, service.slug);
    }
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const openToday = input.shifts.some((shift) => shift.weekday === weekday);
    if (openToday) {
      assert.equal(active.some((booking) => booking.date === today), true);
    }
  }
});

test("panel routes send a signed-out visitor to login", () => {
  assert.equal(panelLoginRedirect(false, "/painel"), "/painel/entrar");
  assert.equal(panelLoginRedirect(false, "/painel/"), "/painel/entrar");
  assert.equal(panelLoginRedirect(false, "/painel/entrar"), null);
  assert.equal(panelLoginRedirect(true, "/painel/entrar"), "/painel");
  assert.equal(panelLoginRedirect(true, "/painel"), null);
  assert.equal(panelLoginRedirect(false, "/"), null);
});

function rememberEnv() {
  return {
    DEMO_MODE: process.env.DEMO_MODE,
    CRON_SECRET: process.env.CRON_SECRET,
    SESSION_SECRET: process.env.SESSION_SECRET,
  };
}

function restoreEnv(saved: { DEMO_MODE?: string; CRON_SECRET?: string; SESSION_SECRET?: string }) {
  for (const key of ["DEMO_MODE", "CRON_SECRET", "SESSION_SECRET"] as const) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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
}

async function catalogSnapshot() {
  const sql = await getSql();
  const services = await sql`
    select s.slug as shop, sv.slug, sv.name, sv.price_cents, sv.duration_minutes
    from services sv
    join shops s on s.id = sv.shop_id
    order by s.slug, sv.slug
  `;
  const barbers = await sql`
    select s.slug as shop, b.slug, b.name
    from barbers b
    join shops s on s.id = b.shop_id
    order by s.slug, b.slug
  `;
  const hours = await sql`
    select s.slug as shop, b.slug as barber, w.weekday, w.start_time::text as start_time, w.end_time::text as end_time
    from weekly_schedule w
    join barbers b on b.id = w.barber_id
    join shops s on s.id = w.shop_id
    order by s.slug, b.slug, w.weekday
  `;
  const owners = await sql`
    select s.slug, o.password_hash
    from owner_accounts o
    join shops s on s.id = o.shop_id
    order by s.slug
  `;
  return { services, barbers, hours, owners };
}

async function countFor(slug: string, table: "bookings" | "blocks"): Promise<number> {
  const sql = await getSql();
  const rows =
    table === "bookings"
      ? await sql<{ n: number }>`
          select count(*)::int as n
          from bookings b
          join shops s on s.id = b.shop_id
          where s.slug = ${slug}
        `
      : await sql<{ n: number }>`
          select count(*)::int as n
          from blocks b
          join shops s on s.id = b.shop_id
          where s.slug = ${slug}
        `;
  return Number(rows[0]?.n ?? 0);
}

function request(header: string | null): Request {
  const headers = new Headers();
  if (header) headers.set("authorization", header);
  return new Request("http://127.0.0.1/api/demo/reset", { headers });
}

test("demo reset, demo login, and shop isolation", async () => {
  const saved = rememberEnv();
  process.env.SESSION_SECRET = SECRET;
  try {
    await ensureOwners();
    await resetBookingRateLimit();

    for (const value of [undefined, "false", "1", ""]) {
      if (value === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = value;
      assert.equal(isDemoMode(), false);
      const login = await loginDemoOwner("ip-demo-off");
      assert.equal(login.ok, false);
      if (!login.ok) assert.equal(login.code, "not_found");
      const hidden = await handleDemoReset(request(`Bearer ${CRON}`));
      assert.equal(hidden.status, 404);
      assert.equal(await hidden.text(), "");
      const pushClosed = await pushSetupForToken(undefined);
      assert.equal(pushClosed.ok, false);
      if (!pushClosed.ok) {
        assert.equal(pushClosed.status, 401);
        assert.equal("error" in pushClosed, false);
        assert.equal("publicKey" in pushClosed, false);
      }
    }

    const still = await loginWithPassword(PASSWORD, "ip-demo-off");
    assert.equal(still.ok, true);

    process.env.DEMO_MODE = "true";
    process.env.CRON_SECRET = CRON;
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args.map((item) => String(item)).join(" "));
    };
    try {
      const missing = await handleDemoReset(request(null));
      const wrong = await handleDemoReset(request("Bearer not-the-secret"));
      assert.equal(missing.status, 401);
      assert.equal(await missing.text(), "");
      assert.equal(wrong.status, 401);
      assert.equal(await wrong.text(), "");
    } finally {
      console.error = originalError;
    }
    assert.equal(logs.some((line) => line.includes(CRON) || line.includes(SECRET)), false);

    const sql = await getSql();
    const foreign = await sql<{ barber_id: string; service_id: string; shop_id: string }>`
      select b.id as barber_id, sv.id as service_id, s.id as shop_id
      from barbers b
      join shops s on s.id = b.shop_id
      join services sv on sv.shop_id = s.id and sv.slug = ${"corte"}
      where s.slug = ${"barbearia-teste"} and b.slug = ${"ana"}
    `;
    const teste = foreign[0];
    assert.ok(teste);
    await sql`
      insert into bookings (
        shop_id, barber_id, service_id, customer_name, customer_phone, starts_at, ends_at, status
      ) values (
        ${teste.shop_id},
        ${teste.barber_id},
        ${teste.service_id},
        ${"Cliente Resetado"},
        ${"92900000001"},
        ${new Date("2026-10-10T15:00:00Z")},
        ${new Date("2026-10-10T16:00:00Z")},
        'active'
      )
    `;
    const before = await catalogSnapshot();
    await sql`
      insert into push_subscriptions (shop_id, owner_account_id, endpoint, p256dh, auth)
      select o.shop_id, o.id, ${"https://push.example.test/leme"}, ${"aaaaaaaaaaaaaaaa"}, ${"bbbbbbbbbbbbbbbb"}
      from owner_accounts o
      join shops s on s.id = o.shop_id
      where s.slug = ${"barbearia-leme"}
    `;
    await sql`
      insert into push_subscriptions (shop_id, owner_account_id, endpoint, p256dh, auth)
      select o.shop_id, o.id, ${"https://push.example.test/teste"}, ${"aaaaaaaaaaaaaaaa"}, ${"bbbbbbbbbbbbbbbb"}
      from owner_accounts o
      join shops s on s.id = o.shop_id
      where s.slug = ${"barbearia-teste"}
    `;

    const reset = await handleDemoReset(request(`Bearer ${CRON}`));
    assert.equal(reset.status, 200);
    const body = (await reset.json()) as { ok: boolean; bookings: number; blocks: number };
    assert.equal(body.ok, true);
    assert.ok(body.bookings > 0);
    assert.ok(body.blocks >= 1);
    assert.equal(Object.keys(body).sort().join(), "blocks,bookings,ok");
    assert.equal(await countFor("barbearia-leme", "bookings"), body.bookings);
    assert.equal(await countFor("barbearia-teste", "bookings"), 0);
    assert.equal(await countFor("barbearia-teste", "blocks"), 0);
    const wiped = await sql<{ id: string }>`select id from bookings where customer_name = ${"Cliente Resetado"}`;
    assert.equal(wiped.length, 0);
    const subsLeft = await sql<{ n: number }>`select count(*)::int as n from push_subscriptions`;
    assert.equal(Number(subsLeft[0]?.n ?? 0), 0);
    assert.deepEqual(await catalogSnapshot(), before);

    const inserted = await sql<{ id: string }>`
      insert into bookings (
        shop_id, barber_id, service_id, customer_name, customer_phone, starts_at, ends_at, status
      ) values (
        ${teste.shop_id},
        ${teste.barber_id},
        ${teste.service_id},
        ${"Cliente Secreto Teste"},
        ${"92900000001"},
        ${new Date("2026-10-10T15:00:00Z")},
        ${new Date("2026-10-10T16:00:00Z")},
        'active'
      )
      returning id
    `;
    const secretId = inserted[0]?.id ?? "";
    const blocked = await sql<{ id: string }>`
      insert into blocks (shop_id, barber_id, starts_at, ends_at, all_day, reason)
      values (
        ${teste.shop_id},
        ${teste.barber_id},
        ${new Date("2026-10-10T18:00:00Z")},
        ${new Date("2026-10-10T20:00:00Z")},
        false,
        ${"Bloqueio secreto"}
      )
      returning id
    `;
    const secretBlock = blocked[0]?.id ?? "";

    const lemeBefore = await countFor("barbearia-leme", "bookings");
    await sql`
      insert into bookings (
        shop_id, barber_id, service_id, customer_name, customer_phone, starts_at, ends_at, status
      )
      select s.id, b.id, sv.id, ${"Nao Apagar"}, ${"71900000999"}, ${new Date("2030-01-15T15:00:00Z")}, ${new Date("2030-01-15T16:00:00Z")}, 'active'
      from shops s
      join barbers b on b.shop_id = s.id and b.slug = ${"rafael"}
      join services sv on sv.shop_id = s.id and sv.slug = ${"corte"}
      where s.slug = ${"barbearia-leme"}
    `;
    await maybeSeedDemoAgenda();
    const kept = await sql<{ id: string }>`select id from bookings where customer_name = ${"Nao Apagar"}`;
    assert.equal(kept.length, 1);
    assert.equal(await countFor("barbearia-leme", "bookings"), lemeBefore + 1);

    await resetBookingRateLimit();
    const demoLogin = await loginDemoOwner("ip-demo-on");
    assert.equal(demoLogin.ok, true);
    if (!demoLogin.ok) return;
    assert.equal(demoLogin.token.includes(PASSWORD), false);
    assert.equal(demoLogin.token.includes(SECRET), false);
    const ownerId = openOwnerSession(demoLogin.token, SECRET);
    const owner = await loadOwner(ownerId ?? "");
    assert.equal(owner?.shopName, "Barbearia Leme");
    const lemeShop = await sql<{ id: string }>`select id from shops where slug = ${"barbearia-leme"}`;
    assert.equal(owner?.shopId, lemeShop[0]?.id);

    const agenda = await agendaForToken(demoLogin.token, {
      view: "week",
      barberId: teste.barber_id,
      includeCancelled: true,
    });
    assert.equal(agenda.ok, false);
    if (!agenda.ok) assert.equal(agenda.status, 404);
    assert.equal("data" in agenda, false);
    assert.equal(JSON.stringify(agenda).includes("Cliente Secreto Teste"), false);

    const own = await agendaForToken(demoLogin.token, {
      view: "week",
      barberId: null,
      includeCancelled: true,
    });
    assert.equal(own.ok, true);
    assert.equal(JSON.stringify(own).includes("Cliente Secreto Teste"), false);
    assert.equal(JSON.stringify(own).includes("Bloqueio secreto"), false);

    const cancel = await cancelForToken(demoLogin.token, secretId);
    assert.equal(cancel.ok, false);
    if (!cancel.ok) {
      assert.equal(cancel.status, 404);
      assert.deepEqual(Object.keys(cancel).sort(), ["ok", "status"]);
    }
    const stillActive = await sql<{ status: string }>`select status from bookings where id = ${secretId}`;
    assert.equal(stillActive[0]?.status, "active");

    const remove = await removeBlockForToken(demoLogin.token, secretBlock);
    assert.equal(remove.ok, false);
    if (!remove.ok) assert.equal(remove.status, 404);
    const blockRemains = await sql<{ id: string }>`select id from blocks where id = ${secretBlock}`;
    assert.equal(blockRemains.length, 1);

    const block = await blockForToken(demoLogin.token, {
      barberId: teste.barber_id,
      date: "2026-10-13",
      allDay: true,
      start: "",
      end: "",
      reason: "invasao",
    });
    assert.equal(block.ok, false);
    if (!block.ok) {
      assert.equal(block.status, 404);
      assert.equal(JSON.stringify(block).includes("Ana"), false);
    }
    const testeBlocks = await sql<{ n: number }>`
      select count(*)::int as n from blocks where shop_id = ${teste.shop_id}
    `;
    assert.equal(Number(testeBlocks[0]?.n ?? 0), 1);

    const unsigned = [
      await agendaForToken(undefined, { view: "today", barberId: null, includeCancelled: false }),
      await cancelForToken(undefined, secretId),
      await blockForToken(undefined, {
        barberId: teste.barber_id,
        date: "2026-10-13",
        allDay: true,
        start: "",
        end: "",
        reason: "",
      }),
      await removeBlockForToken(undefined, secretBlock),
    ];
    for (const result of unsigned) {
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.status, 401);
        assert.equal("data" in result, false);
        assert.equal("message" in result, false);
      }
    }

    process.env.VAPID_PUBLIC_KEY = "public-key-for-test";
    process.env.VAPID_PRIVATE_KEY = "private-key-for-test";
    const setup = await pushSetupForToken(demoLogin.token);
    assert.equal(setup.ok, false);
    if (!setup.ok) {
      assert.equal(setup.status, 403);
      assert.equal("error" in setup ? setup.error : "", DEMO_PUSH_DISABLED);
      assert.equal("publicKey" in setup, false);
    }
    const unsignedPush = await pushSetupForToken(undefined);
    assert.equal(unsignedPush.ok, false);
    if (!unsignedPush.ok) assert.equal(unsignedPush.status, 403);
    const savedPush = await savePushForToken(demoLogin.token, {
      endpoint: "https://push.example.test/demo",
      p256dh: "cccccccccccccccc",
      auth: "dddddddddddddddd",
    });
    assert.equal(savedPush.ok, false);
    if (!savedPush.ok) {
      assert.equal(savedPush.status, 403);
      assert.equal("error" in savedPush ? savedPush.error : "", DEMO_PUSH_DISABLED);
    }
    const direct = await savePushSubscription(
      { ownerId: owner?.ownerId ?? "", shopId: owner?.shopId ?? "" },
      { endpoint: "https://push.example.test/direct", p256dh: "cccccccccccccccc", auth: "dddddddddddddddd" },
    );
    assert.equal(direct.ok, false);
    const storedPush = await sql<{ n: number }>`select count(*)::int as n from push_subscriptions`;
    assert.equal(Number(storedPush[0]?.n ?? 0), 0);

    await sql`
      insert into push_subscriptions (shop_id, owner_account_id, endpoint, p256dh, auth)
      values (
        ${owner?.shopId ?? ""},
        ${owner?.ownerId ?? ""},
        ${"https://push.example.test/already"},
        ${"eeeeeeeeeeeeeeee"},
        ${"ffffffffffffffff"}
      )
    `;
    let pushed = false;
    const sent: string[] = [];
    const originalFetch = globalThis.fetch;
    process.env.RESEND_API_KEY = "re_test_key_not_real";
    process.env.EMAIL_FROM = "agenda@example.com";
    process.env.NOTIFY_EMAIL_TO = "dono@example.com";
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(String(input));
      return new Response("{}", { status: 200, headers: init?.headers });
    };
    try {
      await notifyNewBooking(
        {
          shopId: owner?.shopId ?? "",
          serviceName: "Corte",
          barberName: "Rafael Lima",
          date: "2026-10-10",
          time: "15:00",
          customerName: "Visitante Demo",
          customerPhone: "71900000001",
          priceLabel: "R$ 45",
        },
        {
          pushSender: async () => {
            pushed = true;
            return "ok";
          },
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FROM;
      delete process.env.NOTIFY_EMAIL_TO;
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
    }
    assert.equal(pushed, false);
    assert.equal(sent.some((url) => url.includes("api.resend.com")), true);
    const stillSubscribed = await sql<{ endpoint: string }>`
      select endpoint from push_subscriptions where endpoint = ${"https://push.example.test/already"}
    `;
    assert.equal(stillSubscribed[0]?.endpoint, "https://push.example.test/already");

    const forged = sealOwnerSession("00000000-0000-4000-8000-000000000000", SECRET);
    const rejected = await agendaForToken(forged ?? undefined, {
      view: "today",
      barberId: null,
      includeCancelled: false,
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.status, 401);
  } finally {
    delete process.env.DEMO_MODE;
    restoreEnv(saved);
  }
});
