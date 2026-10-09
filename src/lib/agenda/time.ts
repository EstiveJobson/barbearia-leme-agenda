/**
 * Slot instants are stored in UTC. Wall-clock hours come from the shop timezone
 * (`shops.timezone`, America/Bahia for Barbearia Leme).
 */

/** Offset of `timeZone` at `instant`: wall clock as UTC minus the real UTC instant. */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - instant.getTime();
}

/**
 * UTC instant for a YYYY-MM-DD + HH:mm wall-clock time in `timeZone`.
 * Used for bookings.starts_at / ends_at and for blocks.
 */
export function zonedSlotToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Invalid slot ${date} ${time}`);
  }
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = timeZoneOffsetMs(new Date(wallAsUtc), timeZone);
  let utc = wallAsUtc - firstOffset;
  const secondOffset = timeZoneOffsetMs(new Date(utc), timeZone);
  if (secondOffset !== firstOffset) utc = wallAsUtc - secondOffset;
  return new Date(utc);
}

/** `starts_at` plus the service duration, both UTC. */
export function bookingWindow(
  date: string,
  time: string,
  durationMinutes: number,
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const startsAt = zonedSlotToUtc(date, time, timeZone);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  return { startsAt, endsAt };
}
