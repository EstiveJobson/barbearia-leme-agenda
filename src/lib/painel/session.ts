import { createHmac, timingSafeEqual } from "node:crypto";
import { OWNER_COOKIE_MAX_AGE } from "@/lib/painel/cookie";

export {
  OWNER_COOKIE,
  OWNER_COOKIE_CLEAR,
  OWNER_COOKIE_MAX_AGE,
  OWNER_COOKIE_OPTIONS,
} from "@/lib/painel/cookie";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Payload = { sub: string; exp: number };

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Signed cookie value. Returns null when the secret is empty. */
export function sealOwnerSession(ownerId: string, secret: string, now = Date.now()): string | null {
  if (!secret || !UUID.test(ownerId)) return null;
  const payload: Payload = {
    sub: ownerId,
    exp: Math.floor(now / 1000) + OWNER_COOKIE_MAX_AGE,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Owner account id, or null when the token is missing, expired, or forged. */
export function openOwnerSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): string | null {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!safeEqual(mac, sign(body, secret))) return null;
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
  if (!UUID.test(payload.sub)) return null;
  if (payload.exp * 1000 <= now) return null;
  return payload.sub;
}
