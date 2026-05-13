import { Hono } from "hono";

export const healthApp = new Hono();

healthApp.get("/health", (c) => {
  return c.json({
    ok: true,
    service: "RITS",
    timestamp: new Date().toISOString(),
  });
});
