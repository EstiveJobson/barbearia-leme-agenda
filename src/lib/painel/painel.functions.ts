import { createServerFn } from "@tanstack/react-start";
import { OWNER_COOKIE, OWNER_COOKIE_CLEAR, OWNER_COOKIE_OPTIONS } from "@/lib/painel/cookie";

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function loginInput(input: unknown): { password: string } {
  return { password: text(asRecord(input).password) };
}

function agendaInput(input: unknown): {
  view: "today" | "week";
  barberId: string | null;
  includeCancelled: boolean;
} {
  const record = asRecord(input);
  const view = record.view === "week" ? "week" : "today";
  const barberId = text(record.barberId).trim();
  return {
    view,
    barberId: barberId || null,
    includeCancelled: record.includeCancelled === true,
  };
}

function idInput(input: unknown): { id: string } {
  return { id: text(asRecord(input).id) };
}

function blockInput(input: unknown): {
  barberId: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  reason: string;
} {
  const record = asRecord(input);
  return {
    barberId: text(record.barberId),
    date: text(record.date),
    allDay: record.allDay === true,
    start: text(record.start),
    end: text(record.end),
    reason: text(record.reason),
  };
}

function pushInput(input: unknown): { endpoint: string; p256dh: string; auth: string } {
  const record = asRecord(input);
  return {
    endpoint: text(record.endpoint),
    p256dh: text(record.p256dh),
    auth: text(record.auth),
  };
}

async function clientIp(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const forwarded = request.headers.get("x-forwarded-for");
    return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

async function currentOwner() {
  try {
    const { ownerFromToken } = await import("@/lib/painel/auth.server");
    const { getCookie } = await import("@tanstack/react-start/server");
    return ownerFromToken(getCookie(OWNER_COOKIE));
  } catch {
    return null;
  }
}

async function ownerToken(): Promise<string | undefined> {
  try {
    const { getCookie } = await import("@tanstack/react-start/server");
    return getCookie(OWNER_COOKIE);
  } catch {
    return undefined;
  }
}

async function setStatus(code: number) {
  const { setResponseStatus } = await import("@tanstack/react-start/server");
  setResponseStatus(code);
}

export const fetchPanelGate = createServerFn({ method: "GET" }).handler(async () => {
  const owner = await currentOwner();
  if (!owner) return { ok: false as const };
  return { ok: true as const, shopName: owner.shopName };
});

export const submitPanelLogin = createServerFn({ method: "POST" })
  .validator(loginInput)
  .handler(async ({ data }) => {
    const { loginWithPassword } = await import("@/lib/painel/auth.server");
    const result = await loginWithPassword(data.password, await clientIp());
    if (!result.ok) {
      if (result.code === "rate_limited") {
        const { RATE_LIMIT_MESSAGE } = await import("@/lib/agenda/rate-limit");
        await setStatus(429);
        return { ok: false as const, message: RATE_LIMIT_MESSAGE };
      }
      await setStatus(result.code === "unavailable" ? 503 : 401);
      return { ok: false as const, message: "Não foi possível entrar. Confira a senha." };
    }
    const { setCookie } = await import("@tanstack/react-start/server");
    setCookie(OWNER_COOKIE, result.token, OWNER_COOKIE_OPTIONS);
    return { ok: true as const };
  });

export const submitDemoLogin = createServerFn({ method: "POST" }).handler(async () => {
  const { loginDemoOwner } = await import("@/lib/painel/auth.server");
  const result = await loginDemoOwner(await clientIp());
  if (!result.ok) {
    if (result.code === "rate_limited") {
      const { RATE_LIMIT_MESSAGE } = await import("@/lib/agenda/rate-limit");
      await setStatus(429);
      return { ok: false as const, message: RATE_LIMIT_MESSAGE };
    }
    if (result.code === "unavailable") {
      await setStatus(503);
      return { ok: false as const };
    }
    await setStatus(404);
    return { ok: false as const };
  }
  const { setCookie } = await import("@tanstack/react-start/server");
  setCookie(OWNER_COOKIE, result.token, OWNER_COOKIE_OPTIONS);
  return { ok: true as const };
});

export const submitPanelLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { deleteCookie } = await import("@tanstack/react-start/server");
  deleteCookie(OWNER_COOKIE, OWNER_COOKIE_CLEAR);
  return { ok: true as const };
});

export const fetchAgenda = createServerFn({ method: "POST" })
  .validator(agendaInput)
  .handler(async ({ data }) => {
    const { agendaForToken } = await import("@/lib/painel/panel-api.server");
    const result = await agendaForToken(await ownerToken(), data);
    if (!result.ok) {
      await setStatus(result.status);
      return { ok: false as const };
    }
    return { ok: true as const, data: result.data };
  });

export const cancelPanelBooking = createServerFn({ method: "POST" })
  .validator(idInput)
  .handler(async ({ data }) => {
    const { cancelForToken } = await import("@/lib/painel/panel-api.server");
    const result = await cancelForToken(await ownerToken(), data.id);
    if (!result.ok) {
      await setStatus(result.status);
      return { ok: false as const };
    }
    return { ok: true as const };
  });

export const createPanelBlock = createServerFn({ method: "POST" })
  .validator(blockInput)
  .handler(async ({ data }) => {
    const { blockForToken } = await import("@/lib/painel/panel-api.server");
    const result = await blockForToken(await ownerToken(), data);
    if (!result.ok) {
      await setStatus(result.status);
      if (result.status === 400) {
        return { ok: false as const, message: result.message ?? "Não foi possível bloquear." };
      }
      return { ok: false as const };
    }
    return { ok: true as const };
  });

export const removePanelBlock = createServerFn({ method: "POST" })
  .validator(idInput)
  .handler(async ({ data }) => {
    const { removeBlockForToken } = await import("@/lib/painel/panel-api.server");
    const result = await removeBlockForToken(await ownerToken(), data.id);
    if (!result.ok) {
      await setStatus(result.status);
      return { ok: false as const };
    }
    return { ok: true as const };
  });

export const fetchPushSetup = createServerFn({ method: "GET" }).handler(async () => {
  const { pushSetupForToken } = await import("@/lib/painel/panel-api.server");
  const result = await pushSetupForToken(await ownerToken());
  if (!result.ok) {
    await setStatus(result.status);
    if (result.status === 403) return { error: result.error };
    return { ok: false as const };
  }
  if (!result.enabled) return { ok: true as const, enabled: false as const };
  return { ok: true as const, enabled: true as const, publicKey: result.publicKey };
});

export const savePushSubscription = createServerFn({ method: "POST" })
  .validator(pushInput)
  .handler(async ({ data }) => {
    const { savePushForToken } = await import("@/lib/painel/panel-api.server");
    const result = await savePushForToken(await ownerToken(), data);
    if (!result.ok) {
      await setStatus(result.status);
      if (result.status === 403) return { error: result.error };
      if (result.status === 400) return { ok: false as const, message: result.message };
      return { ok: false as const };
    }
    return { ok: true as const };
  });
