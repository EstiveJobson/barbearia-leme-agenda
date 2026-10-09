import { createFileRoute } from "@tanstack/react-router";
import { PanelAgenda } from "@/components/painel/agenda";

export const Route = createFileRoute("/painel/")({
  component: PanelAgenda,
});
