import { createFileRoute } from "@tanstack/react-router";

async function respond({ request }: { request: Request }): Promise<Response> {
  const { handleDemoResetHttp } = await import("@/lib/demo/demo.server");
  return handleDemoResetHttp(request);
}

export const Route = createFileRoute("/api/demo/reset")({
  server: {
    handlers: {
      GET: respond,
      HEAD: respond,
      POST: respond,
      PUT: respond,
      PATCH: respond,
      DELETE: respond,
      OPTIONS: respond,
      ANY: respond,
    },
  },
});
