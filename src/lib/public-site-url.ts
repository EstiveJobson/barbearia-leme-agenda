import { createServerFn } from "@tanstack/react-start";

const LOCAL_FALLBACK = "http://127.0.0.1:8080";

/**
 * Absolute origin for og:image / og:url. Read on the server from PUBLIC_SITE_URL
 * so the value is in the HTML the server sends, without shipping other env vars
 * to the browser.
 */
export const getPublicSiteUrl = createServerFn({ method: "GET" }).handler(async () => {
  const raw = process.env.PUBLIC_SITE_URL?.trim();
  return (raw && raw.length > 0 ? raw : LOCAL_FALLBACK).replace(/\/+$/, "");
});
