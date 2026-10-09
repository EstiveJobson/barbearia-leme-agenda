import { createFileRoute } from "@tanstack/react-router";
import { Site } from "@/components/barbearia/site";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <Site />;
}
