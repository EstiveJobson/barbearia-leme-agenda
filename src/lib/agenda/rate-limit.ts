const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 8;

const hits = new Map<string, number[]>();

/** True when this IP may attempt another booking. In-memory, per server process. */
export function allowBookingAttempt(ip: string, now = Date.now()): boolean {
  const key = ip.slice(0, 80) || "unknown";
  const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_HITS) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    const oldest = hits.keys().next().value;
    if (oldest) hits.delete(oldest);
  }
  return true;
}

/** Test helper. */
export function resetBookingRateLimit(): void {
  hits.clear();
}
