/** Invented agenda for the public demo. Dates are shop-local calendar days. */

export type DemoService = { slug: string; duration: number };

export type DemoShift = { barberSlug: string; weekday: number; start: string; end: string };

export type DemoBooking = {
  barberSlug: string;
  serviceSlug: string;
  date: string;
  time: string;
  duration: number;
  name: string;
  phone: string;
  status: "active" | "cancelled";
};

export type DemoBlock = {
  barberSlug: string;
  date: string;
  start: string;
  end: string;
  allDay: boolean;
  reason: string;
};

export type DemoPlan = { bookings: DemoBooking[]; blocks: DemoBlock[] };

export type DemoInput = {
  today: string;
  slotMinutes: number;
  barbers: { slug: string }[];
  services: DemoService[];
  shifts: DemoShift[];
};

const PAST_DAYS = 3;
const FUTURE_DAYS = 7;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1)).getUTCDay();
}

function minutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

function clock(total: number): string {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function overlaps(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && end > otherStart;
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rng(seedText: string): () => number {
  let seed = hashSeed(seedText);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j] as T;
    copy[j] = swap as T;
  }
  return copy;
}

type Cell = { barberSlug: string; date: string; start: number; shiftEnd: number };

function grid(input: DemoInput): Cell[] {
  const cells: Cell[] = [];
  const step = Math.max(1, input.slotMinutes);
  for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset += 1) {
    const date = addDays(input.today, offset);
    const weekday = weekdayOf(date);
    for (const barber of input.barbers) {
      const shifts = input.shifts.filter((shift) => shift.barberSlug === barber.slug && shift.weekday === weekday);
      for (const shift of shifts) {
        const start = minutes(shift.start);
        const end = minutes(shift.end);
        if (end <= start) continue;
        for (let cursor = start; cursor + step <= end; cursor += step) {
          cells.push({ barberSlug: barber.slug, date, start: cursor, shiftEnd: end });
        }
      }
    }
  }
  return cells;
}

function demoPhone(index: number): string {
  return `719${String(index + 1).padStart(8, "0")}`;
}

function demoName(index: number): string {
  return `Visitante Demo ${String(index + 1).padStart(2, "0")}`;
}

type Span = { barberSlug: string; date: string; start: number; end: number };

function blocked(spans: Span[], barberSlug: string, date: string, start: number, end: number): boolean {
  return spans.some(
    (span) => span.barberSlug === barberSlug && span.date === date && overlaps(start, end, span.start, span.end),
  );
}

/** Share of grid slots covered by an active booking. Blocks are not counted as filled. */
export function activeFillRatio(plan: DemoPlan, input: DemoInput): number {
  const cells = grid(input);
  if (!cells.length) return 0;
  const step = input.slotMinutes;
  let filled = 0;
  for (const cell of cells) {
    const hit = plan.bookings.some((booking) => {
      if (booking.status !== "active" || booking.barberSlug !== cell.barberSlug || booking.date !== cell.date) {
        return false;
      }
      return overlaps(cell.start, cell.start + step, minutes(booking.time), minutes(booking.time) + booking.duration);
    });
    if (hit) filled += 1;
  }
  return filled / cells.length;
}

/**
 * Bookings from 3 days ago through 7 days ahead, about half the grid filled,
 * plus a few cancelled rows and one or two blocks.
 */
export function buildDemoSample(input: DemoInput): DemoPlan {
  const random = rng(`leme-demo:${input.today}`);
  const cells = grid(input);
  const blocks: DemoBlock[] = [];
  const blockSpans: Span[] = [];

  const futureOpen = [];
  for (let offset = 1; offset <= FUTURE_DAYS; offset += 1) {
    const date = addDays(input.today, offset);
    const weekday = weekdayOf(date);
    if (input.shifts.some((shift) => shift.weekday === weekday)) futureOpen.push(date);
  }

  const firstBarber = input.barbers[0]?.slug;
  const secondBarber = input.barbers[1]?.slug ?? firstBarber;
  const rangeDay = futureOpen[0];
  if (firstBarber && rangeDay) {
    const weekday = weekdayOf(rangeDay);
    const shift = input.shifts.find((item) => item.barberSlug === firstBarber && item.weekday === weekday);
    if (shift) {
      const open = minutes(shift.start);
      const close = minutes(shift.end);
      let start = 14 * 60;
      let end = 16 * 60;
      if (start < open || end > close) {
        start = Math.max(open, close - 120);
        end = close;
      }
      if (end - start >= 60 && end <= close) {
        blocks.push({
          barberSlug: firstBarber,
          date: rangeDay,
          start: clock(start),
          end: clock(end),
          allDay: false,
          reason: "Fornecedor (demo)",
        });
        blockSpans.push({ barberSlug: firstBarber, date: rangeDay, start, end });
      }
    }
  }

  const allDay = futureOpen[1] ?? futureOpen[0];
  if (secondBarber && allDay && blocks.length < 2) {
    const already = blocks.some((block) => block.barberSlug === secondBarber && block.date === allDay);
    if (!already) {
      blocks.push({
        barberSlug: secondBarber,
        date: allDay,
        start: "00:00",
        end: "00:00",
        allDay: true,
        reason: "Folga (demo)",
      });
      blockSpans.push({ barberSlug: secondBarber, date: allDay, start: 0, end: 24 * 60 });
    }
  }

  const placeable = cells.filter((cell) => !blocked(blockSpans, cell.barberSlug, cell.date, cell.start, cell.start + 1));
  const todayCells = shuffle(
    placeable.filter((cell) => cell.date === input.today),
    random,
  );
  const otherCells = shuffle(
    placeable.filter((cell) => cell.date !== input.today),
    random,
  );
  const active: DemoBooking[] = [];
  const taken: Span[] = [...blockSpans];
  const usedBarbers = new Set<string>();
  const usedServices = new Set<string>();
  let person = 0;

  const covered = () => {
    const step = input.slotMinutes;
    let count = 0;
    for (const cell of cells) {
      const hit = active.some(
        (booking) =>
          booking.barberSlug === cell.barberSlug &&
          booking.date === cell.date &&
          overlaps(cell.start, cell.start + step, minutes(booking.time), minutes(booking.time) + booking.duration),
      );
      if (hit) count += 1;
    }
    return count;
  };

  const ordered = [...todayCells, ...otherCells];
  for (const spread of [true, false]) {
    if (!cells.length || covered() / cells.length >= 0.5) break;
    for (const cell of ordered) {
      if (covered() / cells.length >= 0.5) break;
      if (spread && usedBarbers.size < input.barbers.length && usedBarbers.has(cell.barberSlug)) continue;
      const fitting = input.services.filter((service) => cell.start + service.duration <= cell.shiftEnd);
      const pending = fitting.filter((service) => !usedServices.has(service.slug));
      const choices = shuffle(pending.length ? pending : fitting, random);
      for (const service of choices) {
        const end = cell.start + service.duration;
        if (blocked(taken, cell.barberSlug, cell.date, cell.start, end)) continue;
        const booking: DemoBooking = {
          barberSlug: cell.barberSlug,
          serviceSlug: service.slug,
          date: cell.date,
          time: clock(cell.start),
          duration: service.duration,
          name: demoName(person),
          phone: demoPhone(person),
          status: "active",
        };
        person += 1;
        active.push(booking);
        const ratio = covered() / cells.length;
        if (ratio > 0.6) {
          active.pop();
          person -= 1;
          continue;
        }
        taken.push({ barberSlug: cell.barberSlug, date: cell.date, start: cell.start, end });
        usedBarbers.add(cell.barberSlug);
        usedServices.add(service.slug);
        break;
      }
    }
  }

  const cancelled: DemoBooking[] = [];
  const free = shuffle(
    placeable.filter((cell) => !blocked(taken, cell.barberSlug, cell.date, cell.start, cell.start + 30)),
    random,
  );
  for (const cell of free) {
    if (cancelled.length >= 5) break;
    const service = input.services.find((item) => item.duration <= 30 && cell.start + item.duration <= cell.shiftEnd);
    if (!service) continue;
    cancelled.push({
      barberSlug: cell.barberSlug,
      serviceSlug: service.slug,
      date: cell.date,
      time: clock(cell.start),
      duration: service.duration,
      name: demoName(person),
      phone: demoPhone(person),
      status: "cancelled",
    });
    person += 1;
    taken.push({
      barberSlug: cell.barberSlug,
      date: cell.date,
      start: cell.start,
      end: cell.start + service.duration,
    });
  }

  return { bookings: [...active, ...cancelled], blocks };
}
