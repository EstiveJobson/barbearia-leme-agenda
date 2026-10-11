import type { AgendaInput, BlockInput } from "@/lib/painel/agenda.server";
import { ownerFromToken, type OwnerContext } from "@/lib/painel/auth.server";
import { DEMO_PUSH_DISABLED, TEST_PUSH_RATE_LIMIT } from "@/lib/painel/gate";
import type { PushSender } from "@/lib/agenda/notify.server";

export type PanelDenied = { ok: false; status: 401 | 404 | 400; message?: string };

export async function requireOwner(token: string | undefined): Promise<OwnerContext | PanelDenied> {
  if (!token) return { ok: false, status: 401 };
  const owner = await ownerFromToken(token);
  if (!owner) return { ok: false, status: 401 };
  return owner;
}

function denied(value: OwnerContext | PanelDenied): value is PanelDenied {
  return "status" in value;
}

function demoPushOff(): { ok: false; status: 403; error: string } {
  return { ok: false, status: 403, error: DEMO_PUSH_DISABLED };
}

export async function agendaForToken(token: string | undefined, input: AgendaInput) {
  const owner = await requireOwner(token);
  if (denied(owner)) return owner;
  const { loadAgenda } = await import("@/lib/painel/agenda.server");
  const result = await loadAgenda(owner, input);
  if (!result.ok) return { ok: false as const, status: result.status };
  return { ok: true as const, data: result.data };
}

export async function cancelForToken(token: string | undefined, id: string) {
  const owner = await requireOwner(token);
  if (denied(owner)) return owner;
  const { cancelBooking } = await import("@/lib/painel/agenda.server");
  const result = await cancelBooking(owner, id);
  if (!result.ok) return { ok: false as const, status: result.status };
  return { ok: true as const };
}

export async function blockForToken(token: string | undefined, input: BlockInput) {
  const owner = await requireOwner(token);
  if (denied(owner)) return owner;
  const { createBlock } = await import("@/lib/painel/agenda.server");
  const result = await createBlock(owner, input);
  if (!result.ok) return { ok: false as const, status: result.status, message: result.message };
  return { ok: true as const };
}

export async function removeBlockForToken(token: string | undefined, id: string) {
  const owner = await requireOwner(token);
  if (denied(owner)) return owner;
  const { removeBlock } = await import("@/lib/painel/agenda.server");
  const result = await removeBlock(owner, id);
  if (!result.ok) return { ok: false as const, status: result.status };
  return { ok: true as const };
}

export async function pushSetupForToken(token: string | undefined) {
  const owner = await requireOwner(token);
  if (denied(owner)) return owner;
  if (owner.isDemo) return demoPushOff();
  const { pushAvailable } = await import("@/lib/agenda/notify.server");
  const publicKey = pushAvailable();
  if (!publicKey) return { ok: true as const, enabled: false as const };
  return { ok: true as const, enabled: true as const, publicKey };
}

export async function savePushForToken(
  token: string | undefined,
  input: { endpoint: string; p256dh: string; auth: string },
) {
  const owner = await requireOwner(token);
  if (denied(owner)) return owner;
  if (owner.isDemo) return demoPushOff();
  const { savePushSubscription } = await import("@/lib/agenda/notify.server");
  const result = await savePushSubscription(owner, input);
  if (!result.ok) {
    if (result.status === 403) return { ok: false as const, status: 403 as const, error: result.error };
    return { ok: false as const, status: result.status, message: result.message };
  }
  return { ok: true as const };
}

export async function removePushForToken(token: string | undefined, endpoint: string) {
  const owner = await requireOwner(token);
  if (denied(owner)) return owner;
  const { deletePushSubscription } = await import("@/lib/agenda/notify.server");
  await deletePushSubscription(owner, endpoint);
  return { ok: true as const };
}

/**
 * Sends one test push. shop_id comes from the session only.
 * `sender` is for tests; the browser cannot supply it.
 */
export async function sendTestPushForToken(token: string | undefined, sender?: PushSender) {
  const owner = await requireOwner(token);
  if (denied(owner)) return owner;
  if (owner.isDemo) return { ok: false as const, status: 403 as const, message: DEMO_PUSH_DISABLED };
  const { pushAvailable, sendShopTestPush } = await import("@/lib/agenda/notify.server");
  if (!pushAvailable()) {
    return { ok: false as const, status: 400 as const, message: "Avisos não estão disponíveis." };
  }
  const { allowTestPush } = await import("@/lib/agenda/rate-limit");
  if (!(await allowTestPush(owner.ownerId))) {
    return { ok: false as const, status: 429 as const, message: TEST_PUSH_RATE_LIMIT };
  }
  const sent = await sendShopTestPush(owner.shopId, sender);
  return { ok: true as const, sent: sent.sent, message: sent.message };
}
