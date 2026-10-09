import bcrypt from "bcryptjs";
import { getSql } from "@/lib/db";
import { allowAttempt, allowLoginAttempt } from "@/lib/agenda/rate-limit";
import { PUBLIC_SHOP_SLUG } from "@/lib/agenda/shop.server";
import { openOwnerSession, sealOwnerSession } from "@/lib/painel/session";

export type OwnerContext = {
  ownerId: string;
  shopId: string;
  shopName: string;
  timezone: string;
};

/** Cost-12 hash of a string that is not a real password. Used when no account matches. */
const DUMMY_PASSWORD_HASH = "$2b$12$Lb1qqF4cnBtCJUGFwi7t7u1DVFbZHjJhNCC75pesNm7pF/L90EP2e";

function readEnv(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

async function passwordMatches(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/**
 * Check the password against owner_accounts. On success the token carries only
 * that account id. shop_id is never put in the cookie.
 */
export async function loginWithPassword(
  password: string,
  ip: string,
): Promise<
  | { ok: true; token: string }
  | { ok: false; code: "invalid" | "rate_limited" | "unavailable" }
> {
  if (!(await allowLoginAttempt(ip))) return { ok: false, code: "rate_limited" };
  const supplied = typeof password === "string" ? password : "";
  const usable = supplied.length > 0 && supplied.length <= 200 ? supplied : null;

  const sql = await getSql();
  const owners = await sql<{ id: string; password_hash: string; slug: string }>`
    select o.id, o.password_hash, s.slug
    from owner_accounts o
    join shops s on s.id = o.shop_id
  `;

  let matched: { id: string; slug: string } | null = null;
  if (!owners.length) {
    await passwordMatches(usable ?? "owner-login-dummy", DUMMY_PASSWORD_HASH);
  } else {
    for (const owner of owners) {
      const ok = await passwordMatches(usable ?? "owner-login-dummy", owner.password_hash);
      if (!usable || !ok) continue;
      if (!matched || owner.slug === PUBLIC_SHOP_SLUG) matched = owner;
    }
  }
  if (!matched) return { ok: false, code: "invalid" };

  const secret = readEnv("SESSION_SECRET");
  if (!secret) {
    console.error("[painel] SESSION_SECRET is not set");
    return { ok: false, code: "unavailable" };
  }
  const token = sealOwnerSession(matched.id, secret);
  if (!token) return { ok: false, code: "unavailable" };
  return { ok: true, token };
}

/**
 * Passwordless Leme owner session. Only when DEMO_MODE is exactly "true".
 * Never opens another shop, and never creates an account.
 */
export async function loginDemoOwner(
  ip: string,
): Promise<
  | { ok: true; token: string }
  | { ok: false; code: "not_found" | "unavailable" | "rate_limited" }
> {
  if (readEnv("DEMO_MODE") !== "true") return { ok: false, code: "not_found" };
  if (!(await allowAttempt("painel.demo", ip))) return { ok: false, code: "rate_limited" };

  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    select o.id
    from owner_accounts o
    join shops s on s.id = o.shop_id
    where s.slug = ${PUBLIC_SHOP_SLUG}
    limit 1
  `;
  const owner = rows[0];
  if (!owner) {
    console.error("[demo] Leme owner account is missing");
    return { ok: false, code: "not_found" };
  }

  const secret = readEnv("SESSION_SECRET");
  if (!secret) {
    console.error("[painel] SESSION_SECRET is not set");
    return { ok: false, code: "unavailable" };
  }
  const token = sealOwnerSession(owner.id, secret);
  if (!token) return { ok: false, code: "unavailable" };
  return { ok: true, token };
}

/** Load shop_id from owner_accounts. Returns null when the account is gone. */
export async function loadOwner(ownerId: string): Promise<OwnerContext | null> {
  const sql = await getSql();
  const rows = await sql<{
    owner_id: string;
    shop_id: string;
    shop_name: string;
    timezone: string;
  }>`
    select o.id as owner_id, o.shop_id, s.name as shop_name, s.timezone
    from owner_accounts o
    join shops s on s.id = o.shop_id
    where o.id = ${ownerId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    ownerId: row.owner_id,
    shopId: row.shop_id,
    shopName: row.shop_name,
    timezone: row.timezone,
  };
}

/** Cookie session, resolved to the owner's shop. Null when signed out. */
export async function ownerFromToken(token: string | undefined): Promise<OwnerContext | null> {
  const secret = readEnv("SESSION_SECRET");
  const ownerId = openOwnerSession(token, secret);
  if (!ownerId) return null;
  return loadOwner(ownerId);
}
