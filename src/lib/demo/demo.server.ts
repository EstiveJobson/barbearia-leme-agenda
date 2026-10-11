import { createHash, timingSafeEqual } from "node:crypto";
import { getSql, withTransaction, type Sql } from "@/lib/db";
import { insertDemoSampleIfEmpty, writeDemoAgenda } from "@/lib/demo/sample-write";

const LOCK = "demo-agenda";

function readEnv(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function isDemoMode(): boolean {
  return readEnv("DEMO_MODE") === "true";
}

function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

/** True only for `Authorization: Bearer <CRON_SECRET>`. Empty secret never matches. */
export function cronAuthorized(header: string | null): boolean {
  const secret = readEnv("CRON_SECRET");
  if (!secret || !header) return false;
  return safeEqual(header, `Bearer ${secret}`);
}

function logError(label: string, err: unknown): void {
  let text = err instanceof Error ? err.message : "unknown";
  for (const name of [
    "CRON_SECRET",
    "SESSION_SECRET",
    "RESEND_API_KEY",
    "DATABASE_URL",
    "ADMIN_PASSWORD",
    "TEST_SHOP_PASSWORD",
    "VAPID_PRIVATE_KEY",
  ]) {
    const secret = readEnv(name);
    if (secret) text = text.split(secret).join("[redacted]");
  }
  console.error(label, text.slice(0, 300));
}

/** DEMO_MODE and shops.is_demo. A slug or id alone is never enough. */
export async function shopDemoEnabled(slug: string): Promise<boolean> {
  if (!isDemoMode()) return false;
  const shopSlug = slug.trim();
  if (!shopSlug) return false;
  const sql = await getSql();
  const rows = await sql<{ is_demo: boolean }>`
    select is_demo from shops where slug = ${shopSlug} limit 1
  `;
  return rows[0]?.is_demo === true;
}

export async function shopDemoEnabledById(shopId: string): Promise<boolean> {
  if (!isDemoMode()) return false;
  if (!shopId) return false;
  const sql = await getSql();
  const rows = await sql<{ is_demo: boolean }>`
    select is_demo from shops where id = ${shopId} limit 1
  `;
  return rows[0]?.is_demo === true;
}

async function locked<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  return withTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext(${LOCK})::bigint)`;
    return run(sql);
  });
}

let demoSampleChecked = false;

/**
 * Safety net for a process that was not seeded: at most one count, no advisory lock.
 * Later requests in this process return without touching the database.
 */
export async function ensureDemoSampleOnce(now = new Date()): Promise<void> {
  if (demoSampleChecked || !isDemoMode()) return;
  demoSampleChecked = true;
  try {
    const sql = await getSql();
    await insertDemoSampleIfEmpty(sql, now);
  } catch (err) {
    demoSampleChecked = false;
    logError("[demo] seed skipped:", err);
  }
}

/** Delete demo-shop bookings and blocks, then reload each is_demo shop's sample agenda. */
export async function resetDemoAgenda(now = new Date()): Promise<{ bookings: number; blocks: number }> {
  if (!isDemoMode()) return { bookings: 0, blocks: 0 };
  const result = await locked((sql) => writeDemoAgenda(sql, now));
  console.info(`[demo] agenda reset: ${result.bookings} bookings, ${result.blocks} blocks`);
  return result;
}

/** Non-GET requests never reach the cron handler. Vercel Cron uses GET. */
function demoResetNotAllowed(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
}

export async function handleDemoResetHttp(request: Request): Promise<Response> {
  if (request.method !== "GET") return demoResetNotAllowed();
  return handleDemoReset(request);
}

export async function handleDemoReset(request: Request): Promise<Response> {
  if (!isDemoMode()) return new Response(null, { status: 404 });
  if (!cronAuthorized(request.headers.get("authorization"))) {
    console.error("[demo] reset rejected");
    return new Response(null, { status: 401 });
  }
  try {
    const result = await resetDemoAgenda(new Date());
    return Response.json({ ok: true, bookings: result.bookings, blocks: result.blocks });
  } catch (err) {
    logError("[demo] reset failed:", err);
    return new Response(null, { status: 500 });
  }
}
