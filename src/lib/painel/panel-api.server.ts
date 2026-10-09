import type { AgendaInput, BlockInput } from "@/lib/painel/agenda.server";
import { ownerFromToken, type OwnerContext } from "@/lib/painel/auth.server";

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
  const { savePushSubscription } = await import("@/lib/agenda/notify.server");
  const result = await savePushSubscription(owner, input);
  if (!result.ok) return { ok: false as const, status: result.status, message: result.message };
  return { ok: true as const };
}
