import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const ROUTE = "booking.confirm";

export const RATE_LIMIT_MESSAGE = "Muitas tentativas. Tente de novo em alguns minutos.";

function rateKey(ip: string): string {
  const hash = createHash("sha256")
    .update(ip.trim() || "unknown")
    .digest("hex");
  return `${ROUTE}:${hash}`;
}

/**
 * Count one confirm attempt in Postgres (Neon or local PGLite).
 * Eight attempts are allowed per IP per 10-minute window. The ninth returns false.
 * The key stores a hash of the IP, never the address itself.
 */
export async function allowBookingAttempt(ip: string, now = Date.now()): Promise<boolean> {
  const sql = await getSql();
  const cutoff = new Date(now - DAY_MS);
  await sql`delete from rate_limits where window_start < ${cutoff}`;
  const windowStart = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
  const rows = await sql<{ count: number }>`
    insert into rate_limits (key, window_start, count)
    values (${rateKey(ip)}, ${windowStart}, 1)
    on conflict (key, window_start)
    do update set count = rate_limits.count + 1
    returning count
  `;
  return Number(rows[0]?.count ?? 0) <= MAX_HITS;
}

/** Test helper. Clears every window so cases don't share a counter. */
export async function resetBookingRateLimit(): Promise<void> {
  const sql = await getSql();
  await sql`delete from rate_limits`;
}
