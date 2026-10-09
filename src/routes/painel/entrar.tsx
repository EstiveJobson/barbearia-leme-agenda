import { createFileRoute } from "@tanstack/react-router";
import { PanelLogin } from "@/components/painel/login";

export const Route = createFileRoute("/painel/entrar")({
  component: PanelLogin,
});
