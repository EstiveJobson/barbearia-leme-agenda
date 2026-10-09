import assert from "node:assert/strict";
import { test } from "node:test";
import { getSql } from "@/lib/db";
import { confirmBooking, listFreeSlots } from "@/lib/agenda/booking.server";
import { allowBookingAttempt, resetBookingRateLimit } from "@/lib/agenda/rate-limit";
import { shopWhatsAppLink } from "@/lib/agenda/whatsapp.server";
import { parseBrazilianPhone, maskBrazilianPhone } from "@/lib/agenda/phone";
import { freeStartTimes } from "@/lib/agenda/slots";
import { bookingWindow } from "@/lib/agenda/time";

test("phone mask and validation", () => {
  assert.equal(maskBrazilianPhone("71999999999"), "(71) 99999-9999");
  assert.equal(maskBrazilianPhone("7133334444"), "(71) 3333-4444");
  const mobile = parseBrazilianPhone("(71) 99999-9999");
  assert.equal(mobile.ok && mobile.digits, "71999999999");
  assert.equal(parseBrazilianPhone("7199999999").ok, false);
  assert.equal(parseBrazilianPhone("0012345678").ok, false);
  assert.equal(parseBrazilianPhone("7133334444").ok, true);
});

test("free times skip the past, the shift end, and overlaps", () => {
  const timeZone = "America/Bahia";
  const date = "2026-10-13";
  const window = bookingWindow(date, "10:00", 40, timeZone);
  const times = freeStartTimes({
    date,
    timeZone,
    durationMinutes: 40,
    slotMinutes: 30,
    shifts: [{ start: "09:00", end: "12:00" }],
    busy: [{ startsAt: window.startsAt, endsAt: window.endsAt }],
    now: bookingWindow(date, "09:00", 0, timeZone).startsAt,
  });
  assert.equal(times.includes("09:00"), false);
  assert.equal(times.includes("09:30"), false);
  assert.equal(times.includes("10:00"), false);
  assert.equal(times.includes("10:30"), false);
  assert.equal(times.includes("11:00"), true);
  assert.equal(times.includes("11:30"), false);
});

test("saving a slot blocks the overlap and keeps the partial unique index", async () => {
  await resetBookingRateLimit();
  const date = "2026-10-14";
  const times = await listFreeSlots({ serviceSlug: "corte", barberSlug: "rafael", date });
  assert.ok(times.includes("09:00"), `expected 09:00 in ${times.join(",")}`);
  const first = await confirmBooking(
    {
      serviceSlug: "corte",
      barberSlug: "rafael",
      date,
      time: "09:00",
      name: "Ana Souza",
      phone: "(71) 98888-7777",
    },
    "ip-a",
  );
  assert.match(first.waUrl ?? "", /^https:\/\/wa\.me\/5571994130031\?text=/);
  assert.equal(first.waNotice, null);
  assert.match(decodeURIComponent((first.waUrl ?? "").split("text=")[1] ?? ""), /Corte com Rafael Lima em quarta-feira, 14\/10 às 09:00/);
  await assert.rejects(
    () =>
      confirmBooking(
        {
          serviceSlug: "barba",
          barberSlug: "rafael",
          date,
          time: "09:00",
          name: "Bruno",
          phone: "71977776666",
        },
        "ip-b",
      ),
    (err: unknown) => err instanceof Error && err.message.includes("ocupado"),
  );
  await assert.rejects(
    () =>
      confirmBooking(
        {
          serviceSlug: "corte",
          barberSlug: "rafael",
          date,
          time: "09:30",
          name: "Bruno",
          phone: "71977776666",
        },
        "ip-c",
      ),
    (err: unknown) => err instanceof Error && err.message.includes("ocupado"),
  );
  const later = await listFreeSlots({ serviceSlug: "corte", barberSlug: "rafael", date });
  assert.equal(later.includes("09:00"), false);
  assert.equal(later.includes("09:30"), false);
  const sql = await getSql();
  const phones = await sql<{ customer_phone: string }>`
    select customer_phone from bookings where customer_name = ${"Ana Souza"}
  `;
  assert.equal(phones[0]?.customer_phone, "71988887777");
});

test("any barber is assigned on the server and a whole-day block removes that barber", async () => {
  await resetBookingRateLimit();
  const sql = await getSql();
  const barbers = await sql<{ id: string }>`
    select id from barbers where slug = ${"diego"} and shop_id = (
      select id from shops where slug = ${"barbearia-leme"}
    )
  `;
  const diego = barbers[0]?.id;
  assert.ok(diego);
  await sql`
    insert into blocks (shop_id, barber_id, starts_at, ends_at, all_day)
    select shop_id, ${diego}, ${new Date("2026-10-15T03:00:00Z")}, ${new Date("2026-10-16T02:59:00Z")}, true
    from barbers where id = ${diego}
  `;
  const diegoTimes = await listFreeSlots({ serviceSlug: "barba", barberSlug: "diego", date: "2026-10-15" });
  assert.deepEqual(diegoTimes, []);
  const anyTimes = await listFreeSlots({ serviceSlug: "barba", barberSlug: "any", date: "2026-10-15" });
  assert.ok(anyTimes.includes("10:00"));
  const booked = await confirmBooking(
    {
      serviceSlug: "barba",
      barberSlug: "any",
      date: "2026-10-15",
      time: "10:00",
      name: "Caio Cliente",
      phone: "(71) 3333-4444",
    },
    "ip-any",
  );
  assert.notEqual(booked.barberName, "Diego Santos");
  assert.match(booked.barberName, /Rafael Lima|Caio Mendes/);
});

test("rate limit is per IP", async () => {
  await resetBookingRateLimit();
  const payload = {
    serviceSlug: "corte",
    barberSlug: "rafael",
    date: "2026-10-16",
    time: "09:00",
    name: "A",
    phone: "123",
  };
  for (let i = 0; i < 8; i += 1) {
    await assert.rejects(() => confirmBooking(payload, "ip-spam"), /dígitos|nome/i);
  }
  await assert.rejects(() => confirmBooking(payload, "ip-spam"), /Muitas tentativas/);
  const saved = await confirmBooking(
    { ...payload, name: "Nome Valido", phone: "(71) 98888-0000" },
    "ip-ok",
  );
  assert.equal(saved.time, "09:00");
});

test("simultaneous confirms cannot double-book the same slot", async () => {
  await resetBookingRateLimit();
  const payload = {
    serviceSlug: "barba",
    barberSlug: "rafael",
    date: "2026-10-16",
    time: "14:00",
    name: "Corrida",
    phone: "(71) 98888-1111",
  };
  const raced = await Promise.all([
    confirmBooking(payload, "ip-race-1").then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }),
    ),
    confirmBooking(
      { ...payload, name: "Corrida Dois", phone: "(71) 98888-2222" },
      "ip-race-2",
    ).then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }),
    ),
  ]);
  const wins = raced.filter((item) => item.ok);
  const loss = raced.find((item) => !item.ok);
  assert.equal(wins.length, 1, JSON.stringify(raced));
  assert.ok(loss && !loss.ok);
  assert.match(loss.message, /ocupado/);
});

test("a shop with no WhatsApp still saves the booking and does not invent a number", async () => {
  await resetBookingRateLimit();
  const sql = await getSql();
  const teste = await sql<{ id: string; whatsapp: string | null }>`
    select id, whatsapp from shops where slug = ${"barbearia-teste"}
  `;
  assert.equal(teste[0]?.whatsapp ?? null, null);
  assert.equal(await shopWhatsAppLink(sql, teste[0]?.id ?? "", "oi"), null);

  const before = await sql<{ whatsapp: string | null }>`
    select whatsapp from shops where slug = ${"barbearia-leme"}
  `;
  const previous = before[0]?.whatsapp ?? null;
  await sql`update shops set whatsapp = null where slug = ${"barbearia-leme"}`;
  try {
    const saved = await confirmBooking(
      {
        serviceSlug: "corte",
        barberSlug: "rafael",
        date: "2026-10-16",
        time: "16:00",
        name: "Sem Zap",
        phone: "(71) 98888-3333",
      },
      "ip-no-wa",
    );
    assert.equal(saved.waUrl, null);
    assert.equal(
      saved.waNotice,
      "Seu agendamento foi salvo, mas esta barbearia ainda não tem WhatsApp cadastrado.",
    );
    const rows = await sql<{ id: string }>`
      select id from bookings where customer_name = ${"Sem Zap"} and status = 'active'
    `;
    assert.equal(rows.length, 1);
  } finally {
    await sql`update shops set whatsapp = ${previous} where slug = ${"barbearia-leme"}`;
  }
});

test("rate limit windows live in Postgres and do not store the raw IP", async () => {
  await resetBookingRateLimit();
  const sql = await getSql();
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await sql`
    insert into rate_limits (key, window_start, count)
    values (${"booking.confirm:old"}, ${old}, 4)
  `;
  const burst = await Promise.all(
    Array.from({ length: 8 }, () => allowBookingAttempt("ip-burst")),
  );
  assert.equal(burst.every(Boolean), true);
  assert.equal(await allowBookingAttempt("ip-burst"), false);
  const rows = await sql<{ key: string; count: number }>`
    select key, count from rate_limits
  `;
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0]?.count), 9);
  const key = String(rows[0]?.key ?? "");
  assert.equal(key.includes("ip-burst"), false);
  assert.match(key, /^booking\.confirm:[a-f0-9]{64}$/);
});

