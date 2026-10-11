import { createServerFn } from "@tanstack/react-start";

function slugInput(input: unknown): { slug: string } {
  if (!input || typeof input !== "object") return { slug: "" };
  const slug = (input as { slug?: unknown }).slug;
  return { slug: typeof slug === "string" ? slug.trim() : "" };
}

/** Public banner: demo mode and the public shop's is_demo flag. No other env is returned. */
export const fetchDemoMode = createServerFn({ method: "GET" }).handler(async () => {
  const { shopDemoEnabled } = await import("@/lib/demo/demo.server");
  const { PUBLIC_SHOP_SLUG } = await import("@/lib/agenda/shop.server");
  return { enabled: await shopDemoEnabled(PUBLIC_SHOP_SLUG) };
});

/** Login screen: demo button and banner for the shop in ?loja=, not a hardcoded slug. */
export const fetchShopDemo = createServerFn({ method: "GET" })
  .validator(slugInput)
  .handler(async ({ data }) => {
    const { shopDemoEnabled } = await import("@/lib/demo/demo.server");
    return { enabled: await shopDemoEnabled(data.slug) };
  });
