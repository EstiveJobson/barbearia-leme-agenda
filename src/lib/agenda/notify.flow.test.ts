import assert from "node:assert/strict";
import { test } from "node:test";
import { getSql } from "@/lib/db";
import { confirmBooking, listFreeSlots } from "@/lib/agenda/booking.server";
import { resetBookingRateLimit } from "@/lib/agenda/rate-limit";
import {
  notifyNewBooking,
  pushAvailable,
  pushFailureOutcome,
  sanitizeNoticeError,
  savePushSubscription,
  type PushSender,
} from "@/lib/agenda/notify.server";

const KEY = "a".repeat(22);

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

function nextOpenIso(now: Date): string {
  const today = bahiaIso(now);
  for (let offset = 1; offset <= 13; offset += 1) {
    const iso = addDays(today, offset);
    const day = weekday(iso);
    if (day !== 0 && day !== 1) return iso;
  }
  throw new Error("no open day in range");
}

function dayMonth(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

function clearNotifyEnv() {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.NOTIFY_EMAIL_TO;
  delete process.env.PUBLIC_SITE_URL;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
}

async function lemeOwner() {
  const sql = await getSql();
  const rows = await sql<{ id: string; shop_id: string }>`
    insert into owner_accounts (shop_id, password_hash)
    select id, ${"not-a-login-hash"} from shops where slug = ${"barbearia-leme"}
    on conflict (shop_id) do update set password_hash = excluded.password_hash
    returning id, shop_id
  `;
  const owner = rows[0];
  assert.ok(owner);
  return owner;
}

test("push errors treat 404 and 410 as expired and never echo secrets", () => {
  assert.equal(pushFailureOutcome({ statusCode: 410 }), "gone");
  assert.equal(pushFailureOutcome({ statusCode: 404 }), "gone");
  assert.equal(pushFailureOutcome({ statusCode: 500 }), "error");
  assert.equal(pushFailureOutcome(new Error("network")), "error");
  process.env.RESEND_API_KEY = "re_test_key_not_real";
  assert.equal(sanitizeNoticeError(new Error("down re_test_key_not_real")).includes("re_test_key_not_real"), false);
  clearNotifyEnv();
});

test("a saved booking skips email when Resend is not configured", async () => {
  clearNotifyEnv();
  await resetBookingRateLimit();
  const when = nextOpenIso(new Date());
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const saved = await confirmBooking(
      {
        serviceSlug: "corte",
        barberSlug: "rafael",
        date: when,
        time: "11:00",
        name: "Cliente Aviso",
        phone: "(71) 98888-1111",
      },
      "ip-notify-skip",
    );
    assert.equal(saved.serviceName, "Corte");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
    clearNotifyEnv();
  }
});

test("a saved booking emails Resend and still succeeds when the email fails", async () => {
  clearNotifyEnv();
  await resetBookingRateLimit();
  const when = nextOpenIso(new Date());
  const sent: Array<{ url: string; auth: string; body: string }> = [];
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args.map((item) => String(item)).join(" "));
  };
  process.env.RESEND_API_KEY = "re_test_key_not_real";
  process.env.EMAIL_FROM = "agenda@example.com";
  process.env.NOTIFY_EMAIL_TO = "dono@example.com";
  process.env.PUBLIC_SITE_URL = "https://leme.example";

  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    sent.push({
      url: String(input),
      auth: headers.get("authorization") ?? "",
      body: String(init?.body ?? ""),
    });
    return new Response("{}", { status: 200 });
  };

  try {
    const saved = await confirmBooking(
      {
        serviceSlug: "corte",
        barberSlug: "rafael",
        date: when,
        time: "12:00",
        name: "Cliente Email",
        phone: "(71) 98888-2222",
      },
      "ip-notify-email",
    );
    assert.equal(saved.barberName, "Rafael Lima");
    assert.equal(sent.length, 1);
    const payload = JSON.parse(sent[0]?.body ?? "{}") as {
      from: string;
      to: string[];
      subject: string;
      text: string;
    };
    assert.equal(sent[0]?.url, "https://api.resend.com/emails");
    assert.equal(sent[0]?.auth, "Bearer re_test_key_not_real");
    assert.equal(payload.from, "agenda@example.com");
    assert.deepEqual(payload.to, ["dono@example.com"]);
    assert.equal(payload.subject, `Novo agendamento: Corte em ${dayMonth(when)} às 12:00`);
    assert.match(payload.text, /Cliente Email/);
    assert.match(payload.text, /98888-2222/);
    assert.match(payload.text, /Rafael Lima/);
    assert.match(payload.text, /R\$/);
    assert.match(payload.text, /https:\/\/leme\.example\/painel/);
    assert.equal(payload.text.includes("re_test_key_not_real"), false);

    globalThis.fetch = async () => {
      throw new Error("network down re_test_key_not_real");
    };
    const still = await confirmBooking(
      {
        serviceSlug: "corte",
        barberSlug: "rafael",
        date: when,
        time: "13:00",
        name: "Cliente Sem Email",
        phone: "(71) 98888-3333",
      },
      "ip-notify-email-fail",
    );
    assert.equal(still.serviceName, "Corte");
    const free = await listFreeSlots({ serviceSlug: "corte", barberSlug: "rafael", date: when });
    assert.equal(free.includes("13:00"), false);
    assert.equal(errors.some((line) => line.includes("re_test_key_not_real")), false);
    assert.equal(errors.some((line) => line.includes("[notify] email failed")), true);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    clearNotifyEnv();
  }
});

test("push goes only to that shop and expired subscriptions are removed", async () => {
  clearNotifyEnv();
  process.env.VAPID_PUBLIC_KEY = "public-key-for-test";
  process.env.VAPID_PRIVATE_KEY = "private-key-for-test";
  assert.equal(pushAvailable(), "public-key-for-test");
  assert.equal(JSON.stringify(pushAvailable()).includes("private-key-for-test"), false);

  const owner = await lemeOwner();
  const session = { ownerId: owner.id, shopId: owner.shop_id };
  const sql = await getSql();
  const other = await sql<{ id: string; shop_id: string }>`
    insert into owner_accounts (shop_id, password_hash)
    select id, ${"other-hash"} from shops where slug = ${"barbearia-teste"}
    on conflict (shop_id) do update set password_hash = excluded.password_hash
    returning id, shop_id
  `;
  const foreign = other[0];
  assert.ok(foreign);

  const rejected = await savePushSubscription(session, {
    endpoint: "http://insecure.example/push",
    p256dh: KEY,
    auth: KEY,
  });
  assert.equal(rejected.ok, false);

  const saved = await savePushSubscription(
    { ownerId: owner.id, shopId: owner.shop_id },
    { endpoint: "https://push.example.test/leme", p256dh: KEY, auth: KEY },
  );
  assert.equal(saved.ok, true);
  const stored = await sql<{ shop_id: string }>`
    select shop_id from push_subscriptions where endpoint = ${"https://push.example.test/leme"}
  `;
  assert.equal(stored[0]?.shop_id, owner.shop_id);

  await sql`
    insert into push_subscriptions (shop_id, owner_account_id, endpoint, p256dh, auth)
    values (
      ${foreign.shop_id},
      ${foreign.id},
      ${"https://push.example.test/other"},
      ${KEY},
      ${KEY}
    )
  `;
  const gone = await savePushSubscription(session, {
    endpoint: "https://push.example.test/gone",
    p256dh: KEY,
    auth: KEY,
  });
  assert.equal(gone.ok, true);

  const seen: string[] = [];
  const sender: PushSender = async (target, body) => {
    seen.push(`${target.endpoint} ${body}`);
    return target.endpoint.endsWith("/gone") ? "gone" : "ok";
  };
  await notifyNewBooking(
    {
      shopId: owner.shop_id,
      serviceName: "Corte",
      barberName: "Rafael Lima",
      date: "2026-10-10",
      time: "15:00",
      customerName: "Ana",
      customerPhone: "71988884444",
      priceLabel: "R$ 45",
    },
    { pushSender: sender },
  );
  assert.equal(seen.some((line) => line.includes("/other")), false);
  assert.equal(
    seen.some((line) => line === "https://push.example.test/leme Novo agendamento: Corte, 10/10 15:00, Ana"),
    true,
  );
  const left = await sql<{ endpoint: string }>`
    select endpoint from push_subscriptions where shop_id = ${owner.shop_id} order by endpoint
  `;
  assert.deepEqual(
    left.map((row) => row.endpoint),
    ["https://push.example.test/leme"],
  );
  const foreignLeft = await sql<{ endpoint: string }>`
    select endpoint from push_subscriptions where shop_id = ${foreign.shop_id}
  `;
  assert.equal(foreignLeft[0]?.endpoint, "https://push.example.test/other");

  let called = false;
  clearNotifyEnv();
  await notifyNewBooking(
    {
      shopId: owner.shop_id,
      serviceName: "Corte",
      barberName: "Rafael Lima",
      date: "2026-10-10",
      time: "15:00",
      customerName: "Ana",
      customerPhone: "71988884444",
      priceLabel: "R$ 45",
    },
    {
      pushSender: async () => {
        called = true;
        return "ok";
      },
    },
  );
  assert.equal(called, false);
  assert.equal(pushAvailable(), null);
});
