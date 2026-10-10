import { createServerFn } from "@tanstack/react-start";

/** Public flag for the banner and the demo login button. No other env is returned. */
export const fetchDemoMode = createServerFn({ method: "GET" }).handler(async () => {
  const { isDemoMode } = await import("@/lib/demo/demo.server");
  return { enabled: isDemoMode() };
});
