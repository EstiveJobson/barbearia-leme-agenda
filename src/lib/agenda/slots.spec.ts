import { bookingWindow } from "@/lib/agenda/time";
import { freeStartTimes, type BusyRange } from "@/lib/agenda/slots";
import { listFreeSlots, zonedIso } from "@/lib/agenda/booking.server";
import { dbSource, getSql } from "@/lib/db";
import { describe, expect, it } from "vitest";

const timeZone = "America/Bahia";
const date = "2026-10-13";

function at(time: string): Date {
  return bookingWindow(date, time, 0, timeZone).startsAt;
}

const openMorning = {
  date,
  timeZone,
  slotMinutes: 30,
  shifts: [{ start: "09:00", end: "12:00" }],
  now: at("08:00"),
};

describe("freeStartTimes", () => {
  it("excludes a service that does not fit before closing", () => {
    const times = freeStartTimes({ ...openMorning, durationMinutes: 40, busy: [] });
    expect(times).toContain("11:00");
    expect(times).not.toContain("11:30");
    expect(times).not.toContain("12:00");
  });

  it("excludes overlap with an active booking", () => {
    const booking = bookingWindow(date, "10:00", 40, timeZone);
    const busy: BusyRange[] = [{ startsAt: booking.startsAt, endsAt: booking.endsAt }];
    const times = freeStartTimes({ ...openMorning, durationMinutes: 40, busy });
    expect(times).toContain("09:00");
    expect(times).not.toContain("09:30");
    expect(times).not.toContain("10:00");
    expect(times).not.toContain("10:30");
    expect(times).toContain("11:00");
  });

  it("excludes a blocked range", () => {
    const block = bookingWindow(date, "11:00", 60, timeZone);
    const busy: BusyRange[] = [{ startsAt: block.startsAt, endsAt: block.endsAt }];
    const times = freeStartTimes({ ...openMorning, durationMinutes: 30, busy });
    expect(times).toContain("10:30");
    expect(times).not.toContain("11:00");
    expect(times).not.toContain("11:30");
  });

  it("excludes past times today", () => {
    const times = freeStartTimes({
      ...openMorning,
      durationMinutes: 30,
      busy: [],
      now: at("10:15"),
    });
    expect(times).not.toContain("09:00");
    expect(times).not.toContain("09:30");
    expect(times).not.toContain("10:00");
    expect(times).toContain("10:30");
  });
});

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year || 1970, (month || 1) - 1, (day || 1) + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function nextOpenDate(now: Date): string {
  const today = zonedIso(now, timeZone);
  for (let offset = 1; offset <= 13; offset += 1) {
    const iso = addDays(today, offset);
    const [year, month, day] = iso.split("-").map(Number);
    const weekday = new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1)).getUTCDay();
    if (weekday >= 2 && weekday <= 6) return iso;
  }
  throw new Error("no open day inside the booking horizon");
}

describe("saved bookings and blocks", () => {
  it("drops an active booking and a block, and frees the slot when the booking is cancelled", async () => {
    delete process.env.DEMO_MODE;
    expect(dbSource).toBe("pglite");
    const day = nextOpenDate(new Date());
    const open = await listFreeSlots({ serviceSlug: "corte", barberSlug: "rafael", date: day });
    expect(open).toContain("10:00");
    expect(open).toContain("14:00");

    const sql = await getSql();
    const rows = await sql<{ barber_id: string; service_id: string; shop_id: string }>`
      select b.id as barber_id, sv.id as service_id, s.id as shop_id
      from barbers b
      join shops s on s.id = b.shop_id
      join services sv on sv.shop_id = s.id and sv.slug = ${"corte"}
      where s.slug = ${"barbearia-leme"} and b.slug = ${"rafael"}
    `;
    const ids = rows[0];
    expect(ids).toBeTruthy();
    const taken = bookingWindow(day, "10:00", 40, timeZone);
    await sql`
      insert into bookings (
        shop_id, barber_id, service_id, customer_name, customer_phone, starts_at, ends_at, status
      ) values (
        ${ids!.shop_id},
        ${ids!.barber_id},
        ${ids!.service_id},
        ${"Visitante Slot"},
        ${"71900000000"},
        ${taken.startsAt},
        ${taken.endsAt},
        ${"active"}
      )
    `;
    const busy = await listFreeSlots({ serviceSlug: "corte", barberSlug: "rafael", date: day });
    expect(busy).not.toContain("10:00");

    await sql`
      update bookings set status = ${"cancelled"}
      where shop_id = ${ids!.shop_id} and customer_name = ${"Visitante Slot"}
    `;
    const freed = await listFreeSlots({ serviceSlug: "corte", barberSlug: "rafael", date: day });
    expect(freed).toContain("10:00");

    const block = bookingWindow(day, "14:00", 60, timeZone);
    await sql`
      insert into blocks (shop_id, barber_id, starts_at, ends_at, all_day, reason)
      values (
        ${ids!.shop_id},
        ${ids!.barber_id},
        ${block.startsAt},
        ${block.endsAt},
        ${false},
        ${"intervalo"}
      )
    `;
    const blocked = await listFreeSlots({ serviceSlug: "corte", barberSlug: "rafael", date: day });
    expect(blocked).not.toContain("14:00");
    expect(blocked).toContain("10:00");
  });
});
