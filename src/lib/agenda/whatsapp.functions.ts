import { createServerFn } from "@tanstack/react-start";

/** Footer, floating button, and any other public shop WhatsApp link. Null hides them. */
export const fetchPublicShopWhatsApp = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { shopWhatsAppLink } = await import("@/lib/agenda/whatsapp.server");
    const { getSql } = await import("@/lib/db");
    const { PUBLIC_SHOP_SLUG } = await import("@/lib/agenda/shop.server");
    const sql = await getSql();
    const rows = await sql<{ id: string; name: string }>`
      select id, name
      from shops
      where slug = ${PUBLIC_SHOP_SLUG}
      limit 1
    `;
    const shop = rows[0];
    if (!shop) return null;
    return await shopWhatsAppLink(
      sql,
      shop.id,
      `Olá! Vim pelo site da ${shop.name} e quero falar com vocês.`,
    );
  } catch (err) {
    console.error("[whatsapp] public link failed:", err);
    return null;
  }
});
