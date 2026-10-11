import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { getSql } from "@/lib/db";
import { resetDemoAgenda } from "@/lib/demo/demo.server";
import { resetBookingRateLimit } from "@/lib/agenda/rate-limit";
import { loginDemoOwner, loginWithPassword, ownerFromToken } from "@/lib/painel/auth.server";
import { LOGIN_INVALID_MESSAGE, panelLoginRedirect } from "@/lib/painel/gate";
import {
  agendaForToken,
  blockForToken,
  cancelForToken,
  pushSetupForToken,
  removeBlockForToken,
  savePushForToken,
} from "@/lib/painel/panel-api.server";

const SECRET = "auth-demo-spec-secret";
const LEME = "barbearia-leme";
const TESTE = "barbearia-teste";
const LEME_PASSWORD = "leme-senha-spec";
const TESTE_PASSWORD = "teste-senha-spec";
const SECRET_NAME = "Cliente Isolado Qz";

beforeEach(async () => {
  process.env.SESSION_SECRET = SECRET;
  delete process.env.DEMO_MODE;
  await resetBookingRateLimit();
  const sql = await getSql();
  await sql`update shops set is_demo = true where slug in (${LEME}, ${TESTE})`;
  const lemeHash = await bcrypt.hash(LEME_PASSWORD, 4);
  const testeHash = await bcrypt.hash(TESTE_PASSWORD, 4);
  await sql`
    insert into owner_accounts (shop_id, password_hash)
    select id, ${lemeHash} from shops where slug = ${LEME}
    on conflict (shop_id) do update set
      password_hash = excluded.password_hash,
      session_version = owner_accounts.session_version + 1
  `;
  await sql`
    insert into owner_accounts (shop_id, password_hash)
    select id, ${testeHash} from shops where slug = ${TESTE}
    on conflict (shop_id) do update set
      password_hash = excluded.password_hash,
      session_version = owner_accounts.session_version + 1
  `;
});

async function testeFixture() {
  const sql = await getSql();
  const rows = await sql<{ barber_id: string; service_id: string; shop_id: string }>`
    select b.id as barber_id, sv.id as service_id, s.id as shop_id
    from barbers b
    join shops s on s.id = b.shop_id
    join services sv on sv.shop_id = s.id and sv.slug = ${"corte"}
    where s.slug = ${TESTE} and b.slug = ${"ana"}
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new Error("test shop catalog is missing");
  return row;
}

describe("shop isolation", () => {
  it("refuses another shop's agenda, cancel, and block without leaking data", async () => {
    const logged = await loginWithPassword(LEME, LEME_PASSWORD, "ip-iso");
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;

    const sql = await getSql();
    const teste = await testeFixture();
    const inserted = await sql<{ id: string }>`
      insert into bookings (
        shop_id, barber_id, service_id, customer_name, customer_phone, starts_at, ends_at, status
      ) values (
        ${teste.shop_id},
        ${teste.barber_id},
        ${teste.service_id},
        ${SECRET_NAME},
        ${"92900000077"},
        ${new Date("2026-10-20T15:00:00Z")},
        ${new Date("2026-10-20T16:00:00Z")},
        'active'
      )
      returning id
    `;
    const bookingId = inserted[0]?.id ?? "";
    const blocked = await sql<{ id: string }>`
      insert into blocks (shop_id, barber_id, starts_at, ends_at, all_day, reason)
      values (
        ${teste.shop_id},
        ${teste.barber_id},
        ${new Date("2026-10-21T15:00:00Z")},
        ${new Date("2026-10-21T16:00:00Z")},
        false,
        ${"Bloqueio isolado"}
      )
      returning id
    `;
    const blockId = blocked[0]?.id ?? "";
    const blocksBefore = await sql<{ n: number }>`
      select count(*)::int as n from blocks where shop_id = ${teste.shop_id}
    `;

    const agenda = await agendaForToken(logged.token, {
      view: "week",
      barberId: teste.barber_id,
      includeCancelled: true,
    });
    const own = await agendaForToken(logged.token, {
      view: "week",
      barberId: null,
      includeCancelled: true,
    });
    const cancel = await cancelForToken(logged.token, bookingId);
    const block = await blockForToken(logged.token, {
      barberId: teste.barber_id,
      date: "2026-10-20",
      allDay: true,
      start: "",
      end: "",
      reason: "invasao",
    });
    const removed = await removeBlockForToken(logged.token, blockId);

    expect(agenda.ok).toBe(false);
    expect(cancel.ok).toBe(false);
    expect(block.ok).toBe(false);
    expect(removed.ok).toBe(false);
    if (!agenda.ok) expect(agenda.status).toBe(404);
    if (!cancel.ok) expect(cancel.status).toBe(404);
    if (!block.ok) expect(block.status).toBe(404);
    if (!removed.ok) expect(removed.status).toBe(404);

    const leaked = JSON.stringify({ agenda, own, cancel, block, removed });
    expect(leaked).not.toContain(SECRET_NAME);
    expect(leaked).not.toContain("Ana Teste");
    expect(leaked).not.toContain("Bloqueio isolado");

    const still = await sql<{ status: string }>`select status from bookings where id = ${bookingId}`;
    expect(still[0]?.status).toBe("active");
    const blocksAfter = await sql<{ n: number }>`
      select count(*)::int as n from blocks where shop_id = ${teste.shop_id}
    `;
    expect(Number(blocksAfter[0]?.n ?? 0)).toBe(Number(blocksBefore[0]?.n ?? 0));
    const foreignBlock = await sql<{ id: string }>`select id from blocks where id = ${blockId}`;
    expect(foreignBlock).toHaveLength(1);
  });
});

describe("panel auth", () => {
  it("returns 401 from panel APIs when there is no session", async () => {
    const input = {
      view: "today" as const,
      barberId: null,
      includeCancelled: false,
    };
    const block = {
      barberId: "00000000-0000-4000-8000-000000000001",
      date: "2026-10-20",
      allDay: true,
      start: "",
      end: "",
      reason: "",
    };
    const results = [
      await agendaForToken(undefined, input),
      await cancelForToken(undefined, "00000000-0000-4000-8000-000000000002"),
      await blockForToken(undefined, block),
      await removeBlockForToken(undefined, "00000000-0000-4000-8000-000000000003"),
      await pushSetupForToken(undefined),
      await savePushForToken(undefined, {
        endpoint: "https://push.example.test/none",
        p256dh: "aaaaaaaaaaaaaaaa",
        auth: "bbbbbbbbbbbbbbbb",
      }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(401);
    }
    process.env.DEMO_MODE = "true";
    const duringDemo = await pushSetupForToken(undefined);
    expect(duringDemo.ok).toBe(false);
    if (!duringDemo.ok) expect(duringDemo.status).toBe(401);
  });

  it("rejects the right password on the wrong shop and drops a cookie after session_version changes", async () => {
    expect(LOGIN_INVALID_MESSAGE).toBe("Senha ou loja incorreta.");

    const wrongShop = await loginWithPassword(TESTE, LEME_PASSWORD, "ip-wrong-shop");
    expect(wrongShop.ok).toBe(false);
    if (!wrongShop.ok) expect(wrongShop.code).toBe("invalid");

    const alsoWrong = await loginWithPassword(LEME, TESTE_PASSWORD, "ip-wrong-shop-2");
    expect(alsoWrong.ok).toBe(false);
    if (!alsoWrong.ok) expect(alsoWrong.code).toBe("invalid");

    const logged = await loginWithPassword(LEME, LEME_PASSWORD, "ip-right-shop");
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;

    const owner = await ownerFromToken(logged.token);
    expect(owner?.shopName).toBe("Barbearia Leme");
    const agenda = await agendaForToken(logged.token, {
      view: "today",
      barberId: null,
      includeCancelled: false,
    });
    expect(agenda.ok).toBe(true);

    const sql = await getSql();
    await sql`
      update owner_accounts
      set session_version = session_version + 1
      where id = ${owner?.ownerId ?? ""}
    `;
    expect(await ownerFromToken(logged.token)).toBeNull();
    const revoked = await agendaForToken(logged.token, {
      view: "today",
      barberId: null,
      includeCancelled: false,
    });
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) expect(revoked.status).toBe(401);
    expect(panelLoginRedirect(false, "/painel")).toBe("/painel/entrar");
  });
});

describe("demo flag", () => {
  it("refuses demo login for barbearia-teste even when DEMO_MODE is on", async () => {
    process.env.DEMO_MODE = "true";
    const sql = await getSql();
    await sql`update shops set is_demo = true where slug = ${LEME}`;
    await sql`update shops set is_demo = false where slug = ${TESTE}`;
    const denied = await loginDemoOwner(TESTE, "ip-demo-teste-refused");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("not_found");
    const allowed = await loginDemoOwner(LEME, "ip-demo-leme-allowed");
    expect(allowed.ok).toBe(true);
  });

  it("does not demo-login or reset a shop with is_demo false", async () => {
    process.env.DEMO_MODE = "true";
    const sql = await getSql();
    await sql`update shops set is_demo = false where slug = ${LEME}`;
    await sql`update shops set is_demo = true where slug = ${TESTE}`;
    const teste = await testeFixture();
    const lemeRows = await sql<{ barber_id: string; service_id: string; shop_id: string }>`
      select b.id as barber_id, sv.id as service_id, s.id as shop_id
      from barbers b
      join shops s on s.id = b.shop_id
      join services sv on sv.shop_id = s.id and sv.slug = ${"corte"}
      where s.slug = ${LEME} and b.slug = ${"rafael"}
      limit 1
    `;
    const leme = lemeRows[0];
    expect(leme).toBeTruthy();
    if (!leme) return;

    await sql`
      insert into bookings (
        shop_id, barber_id, service_id, customer_name, customer_phone, starts_at, ends_at, status
      ) values (
        ${leme.shop_id}, ${leme.barber_id}, ${leme.service_id},
        ${"Marcador Nao Demo"}, ${"71900000071"},
        ${new Date("2026-11-02T15:00:00Z")}, ${new Date("2026-11-02T16:00:00Z")}, 'active'
      )
    `;
    await sql`
      insert into bookings (
        shop_id, barber_id, service_id, customer_name, customer_phone, starts_at, ends_at, status
      ) values (
        ${teste.shop_id}, ${teste.barber_id}, ${teste.service_id},
        ${"Marcador Demo Shop"}, ${"92900000071"},
        ${new Date("2026-11-02T15:00:00Z")}, ${new Date("2026-11-02T16:00:00Z")}, 'active'
      )
    `;
    await sql`
      insert into push_subscriptions (shop_id, owner_account_id, endpoint, p256dh, auth)
      select o.shop_id, o.id, ${"https://push.example.test/nao-demo"}, ${"aaaaaaaaaaaaaaaa"}, ${"bbbbbbbbbbbbbbbb"}
      from owner_accounts o
      join shops s on s.id = o.shop_id
      where s.slug = ${LEME}
    `;

    const denied = await loginDemoOwner(LEME, "ip-demo-leme");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("not_found");

    const allowed = await loginDemoOwner(TESTE, "ip-demo-teste");
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    const opened = await ownerFromToken(allowed.token);
    expect(opened?.shopId).toBe(teste.shop_id);
    expect(opened?.isDemo).toBe(true);

    await resetDemoAgenda();

    const kept = await sql<{ id: string }>`select id from bookings where customer_name = ${"Marcador Nao Demo"}`;
    expect(kept).toHaveLength(1);
    const wiped = await sql<{ id: string }>`select id from bookings where customer_name = ${"Marcador Demo Shop"}`;
    expect(wiped).toHaveLength(0);
    const lemePush = await sql<{ endpoint: string }>`
      select endpoint from push_subscriptions where endpoint = ${"https://push.example.test/nao-demo"}
    `;
    expect(lemePush).toHaveLength(1);
    const testeBookings = await sql<{ n: number }>`
      select count(*)::int as n from bookings b
      join shops s on s.id = b.shop_id
      where s.slug = ${TESTE}
    `;
    expect(Number(testeBookings[0]?.n ?? 0)).toBeGreaterThan(0);
  });
});
