import assert from "node:assert/strict";
import { test } from "vitest";
import bcrypt from "bcryptjs";
import { getSql } from "@/lib/db";
import { resetBookingRateLimit } from "@/lib/agenda/rate-limit";
import type { PushSender } from "@/lib/agenda/notify.server";
import { DEMO_PUSH_DISABLED, TEST_PUSH_BODY, TEST_PUSH_NONE, TEST_PUSH_RATE_LIMIT, TEST_PUSH_TITLE } from "@/lib/painel/gate";
import { loginWithPassword } from "@/lib/painel/auth.server";
import { sendTestPushForToken } from "@/lib/painel/panel-api.server";

const SECRET = "test-push-spec-secret";
const LEME = "barbearia-leme";
const TESTE = "barbearia-teste";
const LEME_PASSWORD = "leme-test-push";
const TESTE_PASSWORD = "teste-test-push";
const KEY = "a".repeat(22);

function sender(seen: string[]): PushSender {
  return async (target, body) => {
    seen.push(`${target.endpoint} ${body}`);
    return "ok";
  };
}

async function ensureOwners() {
  const sql = await getSql();
  await sql`delete from push_subscriptions`;
  const lemeHash = await bcrypt.hash(LEME_PASSWORD, 4);
  const testeHash = await bcrypt.hash(TESTE_PASSWORD, 4);
  await sql`
    insert into owner_accounts (shop_id, password_hash)
    select id, ${lemeHash} from shops where slug = ${LEME}
    on conflict (shop_id) do update set password_hash = excluded.password_hash
  `;
  await sql`
    insert into owner_accounts (shop_id, password_hash)
    select id, ${testeHash} from shops where slug = ${TESTE}
    on conflict (shop_id) do update set password_hash = excluded.password_hash
  `;
}

async function login(slug: string, password: string, ip: string) {
  const result = await loginWithPassword(slug, password, ip);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("login failed");
  return result.token;
}

async function ownerOf(slug: string) {
  const sql = await getSql();
  const rows = await sql<{ id: string; shop_id: string }>`
    select o.id, o.shop_id
    from owner_accounts o
    join shops s on s.id = o.shop_id
    where s.slug = ${slug}
  `;
  const row = rows[0];
  assert.ok(row);
  return row;
}

async function subscribe(slug: string, endpoint: string) {
  const owner = await ownerOf(slug);
  const sql = await getSql();
  await sql`
    insert into push_subscriptions (shop_id, owner_account_id, endpoint, p256dh, auth)
    values (${owner.shop_id}, ${owner.id}, ${endpoint}, ${KEY}, ${KEY})
  `;
}

test("test push without a session returns 401 and sends nothing", async () => {
  process.env.SESSION_SECRET = SECRET;
  delete process.env.DEMO_MODE;
  process.env.VAPID_PUBLIC_KEY = "public-key-for-test";
  process.env.VAPID_PRIVATE_KEY = "private-key-for-test";
  await resetBookingRateLimit();
  await ensureOwners();
  await subscribe(LEME, "https://push.example.test/leme-nosession");
  const seen: string[] = [];
  const result = await sendTestPushForToken(undefined, sender(seen));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
  assert.deepEqual(seen, []);
});

test("demo shop refuses the test push", async () => {
  process.env.SESSION_SECRET = SECRET;
  process.env.DEMO_MODE = "true";
  process.env.VAPID_PUBLIC_KEY = "public-key-for-test";
  process.env.VAPID_PRIVATE_KEY = "private-key-for-test";
  await resetBookingRateLimit();
  await ensureOwners();
  await subscribe(LEME, "https://push.example.test/leme-demo");
  const token = await login(LEME, LEME_PASSWORD, "ip-test-push-demo");
  const seen: string[] = [];
  const result = await sendTestPushForToken(token, sender(seen));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 403);
    assert.equal("message" in result ? result.message : "", DEMO_PUSH_DISABLED);
  }
  assert.deepEqual(seen, []);
  delete process.env.DEMO_MODE;
});

test("test push reaches only the session shop", async () => {
  process.env.SESSION_SECRET = SECRET;
  delete process.env.DEMO_MODE;
  process.env.VAPID_PUBLIC_KEY = "public-key-for-test";
  process.env.VAPID_PRIVATE_KEY = "private-key-for-test";
  await resetBookingRateLimit();
  await ensureOwners();
  await subscribe(TESTE, "https://push.example.test/teste-only");
  await subscribe(LEME, "https://push.example.test/leme-other");
  const token = await login(TESTE, TESTE_PASSWORD, "ip-test-push-iso");
  const seen: string[] = [];
  const result = await sendTestPushForToken(token, sender(seen));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sent, 1);
  assert.equal(result.message, "Aviso enviado para 1 aparelho(s).");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.includes("https://push.example.test/teste-only"), true);
  assert.equal(seen.some((line) => line.includes("leme-other")), false);
  const payload = JSON.parse(seen[0]?.split(" ").slice(1).join(" ") ?? "{}") as {
    title: string;
    body: string;
    url: string;
  };
  assert.equal(payload.title, TEST_PUSH_TITLE);
  assert.equal(payload.body, TEST_PUSH_BODY);
  assert.equal(payload.url, "/painel");
});

test("the sixth test push in ten minutes is refused and another owner is not", async () => {
  process.env.SESSION_SECRET = SECRET;
  delete process.env.DEMO_MODE;
  process.env.VAPID_PUBLIC_KEY = "public-key-for-test";
  process.env.VAPID_PRIVATE_KEY = "private-key-for-test";
  await resetBookingRateLimit();
  await ensureOwners();
  await subscribe(TESTE, "https://push.example.test/teste-rate");
  await subscribe(LEME, "https://push.example.test/leme-rate");
  const teste = await login(TESTE, TESTE_PASSWORD, "ip-test-push-rate");
  const seen: string[] = [];
  const push = sender(seen);
  for (let i = 0; i < 5; i += 1) {
    const result = await sendTestPushForToken(teste, push);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.sent, 1);
  }
  const limited = await sendTestPushForToken(teste, push);
  assert.equal(limited.ok, false);
  if (!limited.ok) {
    assert.equal(limited.status, 429);
    assert.equal("message" in limited ? limited.message : "", TEST_PUSH_RATE_LIMIT);
  }
  assert.equal(seen.length, 5);

  const leme = await login(LEME, LEME_PASSWORD, "ip-test-push-other-owner");
  const other = await sendTestPushForToken(leme, push);
  assert.equal(other.ok, true);
  if (other.ok) {
    assert.equal(other.sent, 1);
    assert.equal(other.message, "Aviso enviado para 1 aparelho(s).");
  }
  assert.equal(seen.length, 6);
  assert.equal(seen.filter((line) => line.includes("teste-rate")).length, 5);
  assert.equal(seen.filter((line) => line.includes("leme-rate")).length, 1);
});

test("a shop with no subscriptions gets a friendly message and nothing is sent", async () => {
  process.env.SESSION_SECRET = SECRET;
  delete process.env.DEMO_MODE;
  process.env.VAPID_PUBLIC_KEY = "public-key-for-test";
  process.env.VAPID_PRIVATE_KEY = "private-key-for-test";
  await resetBookingRateLimit();
  await ensureOwners();
  const token = await login(TESTE, TESTE_PASSWORD, "ip-test-push-empty");
  const seen: string[] = [];
  const result = await sendTestPushForToken(token, sender(seen));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sent, 0);
  assert.equal(result.message, TEST_PUSH_NONE);
  assert.deepEqual(seen, []);
});

test("missing VAPID keys return a friendly error and do not throw", async () => {
  process.env.SESSION_SECRET = SECRET;
  delete process.env.DEMO_MODE;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  await resetBookingRateLimit();
  await ensureOwners();
  await subscribe(TESTE, "https://push.example.test/teste-novapid");
  const token = await login(TESTE, TESTE_PASSWORD, "ip-test-push-novapid");
  const seen: string[] = [];
  const result = await sendTestPushForToken(token, sender(seen));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.equal("message" in result ? result.message : "", "Avisos não estão disponíveis.");
  }
  assert.deepEqual(seen, []);
});
