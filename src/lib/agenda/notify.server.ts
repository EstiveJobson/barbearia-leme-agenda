import { getSql } from "@/lib/db";
import { maskBrazilianPhone } from "@/lib/agenda/phone";

const RESEND_URL = "https://api.resend.com/emails";
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const PUSH_KEY = /^[A-Za-z0-9_-]{16,200}$/;

export type BookingNotice = {
  shopId: string;
  serviceName: string;
  barberName: string;
  /** YYYY-MM-DD in the shop timezone. */
  date: string;
  /** HH:mm in the shop timezone. */
  time: string;
  customerName: string;
  /** Digits with DDD. */
  customerPhone: string;
  priceLabel: string;
};

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export type PushSender = (target: PushTarget, body: string) => Promise<"ok" | "gone" | "error">;

type NotifyHooks = {
  fetchImpl?: typeof fetch;
  pushSender?: PushSender;
};

type Vapid = { publicKey: string; privateKey: string };

function readVapid(): Vapid | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!publicKey || !privateKey) return null;
  if (/[\r\n]/.test(publicKey) || /[\r\n]/.test(privateKey)) return null;
  return { publicKey, privateKey };
}

/** Public key for the browser, or null when push is not configured. */
export function pushAvailable(): string | null {
  return readVapid()?.publicKey ?? null;
}

function secrets(): string[] {
  return [process.env.RESEND_API_KEY, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

export function sanitizeNoticeError(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value);
  for (const secret of secrets()) text = text.split(secret).join("[redacted]");
  return text.replace(/re_[A-Za-z0-9_-]+/g, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300);
}

function dayMonth(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

function dayMonthYear(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function subjectLine(notice: BookingNotice): string {
  return `Novo agendamento: ${notice.serviceName} em ${dayMonth(notice.date)} às ${notice.time}`;
}

function pushLine(notice: BookingNotice): string {
  return `Novo agendamento: ${notice.serviceName}, ${dayMonth(notice.date)} ${notice.time}, ${notice.customerName}`;
}

function panelLink(): string | null {
  const raw = process.env.PUBLIC_SITE_URL?.trim() ?? "";
  if (!raw || /[\s\r\n]/.test(raw) || !/^https?:\/\//i.test(raw)) return null;
  return `${raw.replace(/\/+$/, "")}/painel`;
}

function emailBody(notice: BookingNotice): string {
  const phone = maskBrazilianPhone(notice.customerPhone) || notice.customerPhone;
  const lines = [
    `Cliente: ${notice.customerName}`,
    `Telefone: ${phone}`,
    `Serviço: ${notice.serviceName}`,
    `Barbeiro: ${notice.barberName}`,
    `Dia: ${dayMonthYear(notice.date)}`,
    `Horário: ${notice.time}`,
    `Preço: ${notice.priceLabel}`,
  ];
  const link = panelLink();
  if (link) lines.push("", link);
  return lines.join("\n");
}

function fromOk(value: string): boolean {
  if (EMAIL.test(value)) return true;
  const match = /^(.*)<([^<>]+)>$/.exec(value);
  if (!match) return false;
  const name = match[1]?.trim() ?? "";
  const email = match[2]?.trim() ?? "";
  return name.length > 0 && name.length <= 80 && EMAIL.test(email);
}

function emailConfig(): { apiKey: string; from: string; to: string } | null {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  const to = process.env.NOTIFY_EMAIL_TO?.trim() ?? "";
  if (!apiKey || !from || !to) {
    console.info("[notify] email skipped: RESEND_API_KEY, EMAIL_FROM, or NOTIFY_EMAIL_TO is not set");
    return null;
  }
  if (/[\r\n]/.test(apiKey) || /[\r\n]/.test(from) || /[\r\n]/.test(to) || !fromOk(from) || !EMAIL.test(to)) {
    console.info("[notify] email skipped: EMAIL_FROM or NOTIFY_EMAIL_TO is invalid");
    return null;
  }
  return { apiKey, from, to };
}

async function sendBookingEmail(notice: BookingNotice, fetchImpl: typeof fetch): Promise<void> {
  const config = emailConfig();
  if (!config) return;
  try {
    const response = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [config.to],
        subject: subjectLine(notice),
        text: emailBody(notice),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const detail = sanitizeNoticeError(await response.text());
      console.error(`[notify] email failed: HTTP ${response.status} ${detail}`);
      return;
    }
    await response.text().catch(() => undefined);
    console.info("[notify] email sent");
  } catch (err) {
    console.error("[notify] email failed:", sanitizeNoticeError(err));
  }
}

export function pushFailureOutcome(err: unknown): "gone" | "error" {
  if (!err || typeof err !== "object" || !("statusCode" in err)) return "error";
  const status = Number((err as { statusCode: unknown }).statusCode);
  if (status === 404 || status === 410) return "gone";
  return "error";
}

function vapidSubject(): string {
  const site = process.env.PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ?? "";
  if (/^https?:\/\//i.test(site)) return site;
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  const email = from.match(EMAIL)?.[0] ?? from.match(/[^\s<>@]+@[^\s<>@]+/)?.[0];
  if (email && EMAIL.test(email)) return `mailto:${email}`;
  return "mailto:painel@localhost";
}

async function deliverWithWebPush(keys: Vapid, target: PushTarget, body: string): Promise<"ok" | "gone" | "error"> {
  try {
    const mod = (await import("web-push")) as typeof import("web-push") & {
      default?: typeof import("web-push");
    };
    const lib = mod.default ?? mod;
    await lib.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      body,
      {
        timeout: 8000,
        TTL: 60 * 60,
        urgency: "high",
        vapidDetails: {
          subject: vapidSubject(),
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
      },
    );
    return "ok";
  } catch (err) {
    const outcome = pushFailureOutcome(err);
    if (outcome === "gone") return "gone";
    console.error("[notify] push failed:", sanitizeNoticeError(err));
    return "error";
  }
}

async function sendBookingPush(notice: BookingNotice, sender?: PushSender): Promise<void> {
  const keys = readVapid();
  if (!keys) {
    console.info("[notify] push skipped: VAPID keys are not set");
    return;
  }
  const sql = await getSql();
  const rows = await sql<{ id: string; endpoint: string; p256dh: string; auth: string }>`
    select id, endpoint, p256dh, auth
    from push_subscriptions
    where shop_id = ${notice.shopId}
    order by created_at desc
    limit 30
  `;
  if (!rows.length) return;
  const body = pushLine(notice);
  const deliver = sender ?? ((target: PushTarget) => deliverWithWebPush(keys, target, body));
  for (const row of rows) {
    let outcome: "ok" | "gone" | "error" = "error";
    try {
      outcome = await deliver({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }, body);
    } catch (err) {
      console.error("[notify] push failed:", sanitizeNoticeError(err));
      continue;
    }
    if (outcome === "gone") {
      await sql`
        delete from push_subscriptions
        where id = ${row.id} and shop_id = ${notice.shopId}
      `;
    }
  }
}

/** Email and push after the booking row is committed. Never throws. */
export async function notifyNewBooking(notice: BookingNotice, hooks?: NotifyHooks): Promise<void> {
  await sendBookingEmail(notice, hooks?.fetchImpl ?? globalThis.fetch.bind(globalThis));
  await sendBookingPush(notice, hooks?.pushSender);
}

function endpointOk(value: string): boolean {
  if (value.length < 12 || value.length > 2000) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export async function savePushSubscription(
  owner: { ownerId: string; shopId: string },
  input: { endpoint: string; p256dh: string; auth: string },
): Promise<{ ok: true } | { ok: false; status: 400; message: string }> {
  if (!readVapid()) {
    return { ok: false, status: 400, message: "Avisos não estão disponíveis." };
  }
  const endpoint = input.endpoint.trim();
  const p256dh = input.p256dh.trim();
  const auth = input.auth.trim();
  if (!endpointOk(endpoint) || !PUSH_KEY.test(p256dh) || !PUSH_KEY.test(auth)) {
    return { ok: false, status: 400, message: "Não foi possível ativar os avisos." };
  }
  const sql = await getSql();
  await sql`
    insert into push_subscriptions (shop_id, owner_account_id, endpoint, p256dh, auth)
    values (${owner.shopId}, ${owner.ownerId}, ${endpoint}, ${p256dh}, ${auth})
    on conflict (shop_id, endpoint) do update
    set owner_account_id = excluded.owner_account_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        created_at = now()
  `;
  return { ok: true };
}
