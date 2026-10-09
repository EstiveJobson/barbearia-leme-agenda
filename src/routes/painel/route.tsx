import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { panelLoginRedirect } from "@/lib/painel/gate";
import { fetchPanelGate } from "@/lib/painel/painel.functions";

export const Route = createFileRoute("/painel")({
  beforeLoad: async ({ location }) => {
    const gate = await fetchPanelGate();
    const target = panelLoginRedirect(gate.ok, location.pathname);
    if (target) throw redirect({ to: target });
  },
  head: () => ({
    meta: [
      { title: "Painel Leme" },
      { name: "theme-color", content: "#090909" },
      { name: "apple-mobile-web-app-title", content: "Painel Leme" },
    ],
    links: [
      { rel: "manifest", href: "/painel.webmanifest" },
      { rel: "apple-touch-icon", href: "/painel/apple-touch-icon.png" },
    ],
  }),
  component: PanelLayout,
});

function PanelLayout() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-ink text-cream">
      <Outlet />
    </div>
  );
}
