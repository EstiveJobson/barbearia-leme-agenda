import { describe, expect, it } from "vitest";
import { shop } from "@/shop-config";
import { maskBrazilianPhone } from "@/lib/agenda/phone";
import { activeFillRatio, buildDemoSample, type DemoInput } from "@/lib/demo/sample";

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

describe("barbearia-leme sample fill", () => {
  it("fills between 20% and 40% of the slots with fictional names and phones", () => {
    const input = lemeInput("2026-10-10");
    const plan = buildDemoSample(input);
    const ratio = activeFillRatio(plan, input);
    expect(ratio).toBeGreaterThanOrEqual(0.2);
    expect(ratio).toBeLessThanOrEqual(0.4);
    expect(plan.blocks.length).toBeGreaterThanOrEqual(1);
    expect(plan.blocks.length).toBeLessThanOrEqual(2);
    const cancelled = plan.bookings.filter((booking) => booking.status === "cancelled");
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
    expect(plan.bookings.some((booking) => /Demo|Visitante/.test(booking.name))).toBe(false);
    expect(maskBrazilianPhone(plan.bookings[0]?.phone ?? "")).toBe("(71) 90000-0001");
    for (const booking of plan.bookings) {
      expect(booking.phone).toMatch(/^7190000\d{4}$/);
    }
  });
});
