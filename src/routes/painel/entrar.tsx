import { createFileRoute } from "@tanstack/react-router";
import { PanelLogin } from "@/components/painel/login";
import { fetchShopDemo } from "@/lib/demo/demo.functions";

const DEFAULT_LOGIN_SLUG = "barbearia-leme";

export const Route = createFileRoute("/painel/entrar")({
  validateSearch: (search: Record<string, unknown>) => {
    const raw = typeof search.loja === "string" ? search.loja.trim() : "";
    return { loja: raw || DEFAULT_LOGIN_SLUG };
  },
  loaderDeps: ({ search }) => ({ loja: search.loja }),
  loader: async ({ deps }) => {
    const demo = await fetchShopDemo({ data: { slug: deps.loja } });
    return { demo: demo.enabled };
  },
  component: PanelLogin,
});
