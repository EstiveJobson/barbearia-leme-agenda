import bcrypt from "bcryptjs";
import { getSql } from "@/lib/db";
import { allowAttempt, allowLoginAttempt } from "@/lib/agenda/rate-limit";
import { isDemoMode } from "@/lib/demo/demo.server";
import { openOwnerSession, sealOwnerSession } from "@/lib/painel/session";

export type OwnerContext = {
  ownerId: string;
  shopId: string;
  shopName: string;
  timezone: string;
  sessionVersion: number;
  /** DEMO_MODE is on and this shop's is_demo flag is true. */
  isDemo: boolean;
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
 * Check the password against one shop's owner account. The slug comes from the
 * login screen. This never scans other owners and never prefers a shop on a tie.
 */
export async function loginWithPassword(
  slug: string,
  password: string,
  ip: string,
): Promise<
  | { ok: true; token: string }
  | { ok: false; code: "invalid" | "rate_limited" | "unavailable" }
> {
  if (!(await allowLoginAttempt(ip))) return { ok: false, code: "rate_limited" };
  const supplied = typeof password === "string" ? password : "";
  const usable = supplied.length > 0 && supplied.length <= 200 ? supplied : null;
  const shopSlug = typeof slug === "string" ? slug.trim() : "";

  const sql = await getSql();
  const owners = shopSlug
    ? await sql<{ id: string; password_hash: string; session_version: number }>`
        select o.id, o.password_hash, o.session_version
        from owner_accounts o
        join shops s on s.id = o.shop_id
        where s.slug = ${shopSlug}
        limit 1
      `
    : [];
  const owner = owners[0];
  const hash = owner?.password_hash || DUMMY_PASSWORD_HASH;
  const ok = await passwordMatches(usable ?? "owner-login-dummy", hash);
  if (!owner || !usable || !ok) return { ok: false, code: "invalid" };

  const secret = readEnv("SESSION_SECRET");
  if (!secret) {
    console.error("[painel] SESSION_SECRET is not set");
    return { ok: false, code: "unavailable" };
  }
  const token = sealOwnerSession(owner.id, secret, Date.now(), Number(owner.session_version));
  if (!token) return { ok: false, code: "unavailable" };
  return { ok: true, token };
}

/**
 * Passwordless session for the shop on the login screen.
 * Only when DEMO_MODE is exactly "true" and that shop has is_demo.
 */
export async function loginDemoOwner(
  slug: string,
  ip: string,
): Promise<
  | { ok: true; token: string }
  | { ok: false; code: "not_found" | "unavailable" | "rate_limited" }
> {
  if (!isDemoMode()) return { ok: false, code: "not_found" };
  if (!(await allowAttempt("painel.demo", ip))) return { ok: false, code: "rate_limited" };

  const shopSlug = typeof slug === "string" ? slug.trim() : "";
  const sql = await getSql();
  const rows = shopSlug
    ? await sql<{ id: string; session_version: number; is_demo: boolean }>`
        select o.id, o.session_version, s.is_demo
        from owner_accounts o
        join shops s on s.id = o.shop_id
        where s.slug = ${shopSlug}
        limit 1
      `
    : [];
  const owner = rows[0];
  if (!owner || owner.is_demo !== true) return { ok: false, code: "not_found" };

  const secret = readEnv("SESSION_SECRET");
  if (!secret) {
    console.error("[painel] SESSION_SECRET is not set");
    return { ok: false, code: "unavailable" };
  }
  const token = sealOwnerSession(owner.id, secret, Date.now(), Number(owner.session_version));
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
    session_version: number;
    is_demo: boolean;
  }>`
    select o.id as owner_id, o.shop_id, s.name as shop_name, s.timezone, o.session_version, s.is_demo
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
    sessionVersion: Number(row.session_version),
    isDemo: isDemoMode() && row.is_demo === true,
  };
}

/** Cookie session, resolved to the owner's shop. Null when signed out or revoked. */
export async function ownerFromToken(token: string | undefined): Promise<OwnerContext | null> {
  const secret = readEnv("SESSION_SECRET");
  const opened = openOwnerSession(token, secret);
  if (!opened) return null;
  const owner = await loadOwner(opened.ownerId);
  if (!owner || owner.sessionVersion !== opened.sessionVersion) return null;
  return owner;
}
