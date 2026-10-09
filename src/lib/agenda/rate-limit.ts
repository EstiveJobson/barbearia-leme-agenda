import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOOKING_ROUTE = "booking.confirm";
const LOGIN_ROUTE = "painel.login";

export const RATE_LIMIT_MESSAGE = "Muitas tentativas. Tente de novo em alguns minutos.";

type Limit = { windowMs: number; max: number };

const DEFAULT_LIMIT: Limit = { windowMs: WINDOW_MS, max: MAX_HITS };

function rateKey(route: string, ip: string): string {
  const hash = createHash("sha256")
    .update(ip.trim() || "unknown")
    .digest("hex");
  return `${route}:${hash}`;
}

/**
 * Count one attempt in Postgres (Neon or local PGLite).
 * The key is the route name plus a SHA-256 of the IP. Raw IPs are not stored.
 * Returns false once `max` attempts land in the current window.
 */
export async function allowAttempt(
  route: string,
  ip: string,
  limit: Limit = DEFAULT_LIMIT,
  now = Date.now(),
): Promise<boolean> {
  if (!/^[a-z0-9._-]{1,40}$/.test(route)) {
    throw new Error("Invalid rate limit route");
  }
  const sql = await getSql();
  const cutoff = new Date(now - DAY_MS);
  await sql`delete from rate_limits where window_start < ${cutoff}`;
  const windowStart = new Date(Math.floor(now / limit.windowMs) * limit.windowMs);
  const rows = await sql<{ count: number }>`
    insert into rate_limits (key, window_start, count)
    values (${rateKey(route, ip)}, ${windowStart}, 1)
    on conflict (key, window_start)
    do update set count = rate_limits.count + 1
    returning count
  `;
  return Number(rows[0]?.count ?? 0) <= limit.max;
}

/** Eight booking confirms per IP per 10 minutes. */
export function allowBookingAttempt(ip: string, now = Date.now()): Promise<boolean> {
  return allowAttempt(BOOKING_ROUTE, ip, DEFAULT_LIMIT, now);
}

/** Eight panel login attempts per IP per 10 minutes. */
export function allowLoginAttempt(ip: string, now = Date.now()): Promise<boolean> {
  return allowAttempt(LOGIN_ROUTE, ip, DEFAULT_LIMIT, now);
}

/** Test helper. Clears every window so cases don't share a counter. */
export async function resetBookingRateLimit(): Promise<void> {
  const sql = await getSql();
  await sql`delete from rate_limits`;
}
