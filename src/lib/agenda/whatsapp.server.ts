import type { Sql } from "@/lib/db";

/** Shown when the booking was saved and the shop has no WhatsApp number. */
export const NO_SHOP_WHATSAPP =
  "Seu agendamento foi salvo, mas esta barbearia ainda não tem WhatsApp cadastrado.";

/**
 * The only builder of a link to a shop's WhatsApp.
 *
 * `shopId` must already have been resolved on the server (public slug or, later,
 * the owner session). The number is `shops.whatsapp`: digits with DDD, no country
 * code. Returns `https://wa.me/55<number>?text=<message>`, or null when the shop
 * has no number. Never falls back to a default.
 *
 * The owner panel's "Chamar no WhatsApp" button must use the customer's phone,
 * not this helper.
 */
export async function shopWhatsAppLink(
  sql: Sql,
  shopId: string,
  message: string,
): Promise<string | null> {
  const rows = await sql<{ whatsapp: string | null }>`
    select whatsapp
    from shops
    where id = ${shopId}
    limit 1
  `;
  const digits = String(rows[0]?.whatsapp ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const local =
    digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits;
  if (!local) return null;
  return `https://wa.me/55${local}?text=${encodeURIComponent(message)}`;
}
