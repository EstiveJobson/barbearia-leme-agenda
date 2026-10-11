import { describe, expect, it } from "vitest";
import { clampWeekOffset, weekRange } from "@/lib/painel/agenda.server";

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

describe("panel week range", () => {
  it("starts today and the next-week arrow covers the rest of the 14 public days", () => {
    const today = "2026-10-10";
    const current = weekRange(today, 0);
    expect(current).toHaveLength(7);
    expect(current[0]).toBe(today);
    expect(current[6]).toBe(addDays(today, 6));

    const next = weekRange(today, 1);
    expect(next[0]).toBe(addDays(today, 7));
    expect(next[6]).toBe(addDays(today, 13));

    const previous = weekRange(today, -1);
    expect(previous[0]).toBe(addDays(today, -7));
    expect(previous[6]).toBe(addDays(today, -1));

    expect(weekRange(today, 4)).toEqual(next);
    expect(weekRange(today, -9)).toEqual(previous);
    expect(clampWeekOffset(Number.NaN)).toBe(0);
  });
});
