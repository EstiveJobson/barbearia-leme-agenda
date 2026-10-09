import { createFileRoute } from "@tanstack/react-router";
import { Site } from "@/components/barbearia/site";
import { fetchPublicShopWhatsApp } from "@/lib/agenda/whatsapp.functions";

export const Route = createFileRoute("/")({
  loader: () => fetchPublicShopWhatsApp(),
  component: Home,
});

function Home() {
  const shopWhatsApp = Route.useLoaderData();
  return <Site shopWhatsApp={shopWhatsApp} />;
}

