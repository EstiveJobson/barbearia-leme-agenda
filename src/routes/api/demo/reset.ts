import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/demo/reset")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleDemoReset } = await import("@/lib/demo/demo.server");
        return handleDemoReset(request);
      },
    },
  },
});
