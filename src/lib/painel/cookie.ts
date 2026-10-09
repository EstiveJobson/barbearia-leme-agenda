/** Owner panel cookie. No crypto here — the browser bundle can import these flags. */

export const OWNER_COOKIE = "leme_owner";

export const OWNER_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export const OWNER_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: OWNER_COOKIE_MAX_AGE,
};

/** Same flags as the session cookie, with maxAge 0 so the browser drops it. */
export const OWNER_COOKIE_CLEAR = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 0,
};
