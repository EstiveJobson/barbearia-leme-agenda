import { describe, expect, it } from "vitest";
import { Route } from "@/routes/api/demo/reset";

type Handler = (ctx: { request: Request }) => Promise<Response | undefined>;

function handlerFor(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "ANY",
): Handler {
  const handlers = Route.options.server?.handlers;
  if (!handlers || typeof handlers === "function") {
    throw new Error("reset route is missing method handlers");
  }
  const handler = handlers[method];
  if (typeof handler !== "function") throw new Error(`missing ${method} handler`);
  return handler as Handler;
}

function call(method: string): Promise<Response | undefined> {
  const known = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
  const key = (known as readonly string[]).includes(method)
    ? (method as (typeof known)[number])
    : "ANY";
  return handlerFor(key)({
    request: new Request("http://127.0.0.1/api/demo/reset", { method }),
  });
}

describe("/api/demo/reset", () => {
  it("rejects POST and every other method with 405 and Allow: GET", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const response = await call(method);
      expect(response?.status, method).toBe(405);
      expect(response?.headers.get("allow"), method).toBe("GET");
    }
    const fallback = await handlerFor("ANY")({
      request: new Request("http://127.0.0.1/api/demo/reset", { method: "POST" }),
    });
    expect(fallback?.status).toBe(405);
    expect(fallback?.headers.get("allow")).toBe("GET");
  });

  it("returns 401 for GET without the correct bearer token", async () => {
    const savedDemo = process.env.DEMO_MODE;
    const savedCron = process.env.CRON_SECRET;
    process.env.DEMO_MODE = "true";
    process.env.CRON_SECRET = "cron-test-secret";
    try {
      const missing = await call("GET");
      expect(missing?.status).toBe(401);
      const wrong = await handlerFor("GET")({
        request: new Request("http://127.0.0.1/api/demo/reset", {
          headers: { authorization: "Bearer not-the-secret" },
        }),
      });
      expect(wrong?.status).toBe(401);
    } finally {
      if (savedDemo === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = savedDemo;
      if (savedCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = savedCron;
    }
  });
});
