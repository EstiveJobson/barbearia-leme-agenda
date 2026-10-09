import { bookingWindow } from "@/lib/agenda/time";

export type BusyRange = { startsAt: Date; endsAt: Date };

export type Shift = { start: string; end: string };

function minutes(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})/.exec(hhmm);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function clock(total: number): string {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

/**
 * Free start times for one barber on one local date.
 * A candidate must sit on the shop grid, finish at or before the shift end,
 * not be in the past, and not overlap a busy range (active booking or block).
 */
export function freeStartTimes(options: {
  date: string;
  timeZone: string;
  durationMinutes: number;
  slotMinutes: number;
  shifts: Shift[];
  busy: BusyRange[];
  now: Date;
}): string[] {
  const step = Math.max(1, options.slotMinutes);
  const duration = options.durationMinutes;
  if (duration <= 0) return [];
  const times: string[] = [];
  for (const shift of options.shifts) {
    const start = minutes(shift.start);
    const end = minutes(shift.end);
    if (start == null || end == null || end <= start) continue;
    for (let cursor = start; cursor + duration <= end; cursor += step) {
      const time = clock(cursor);
      const window = bookingWindow(options.date, time, duration, options.timeZone);
      if (window.startsAt.getTime() <= options.now.getTime()) continue;
      const hit = options.busy.some((range) =>
        rangesOverlap(window.startsAt, window.endsAt, range.startsAt, range.endsAt),
      );
      if (!hit) times.push(time);
    }
  }
  return [...new Set(times)].sort();
}

/** Union of free times. Used when the customer picked "Qualquer um". */
export function unionFreeTimes(groups: string[][]): string[] {
  return [...new Set(groups.flat())].sort();
}
