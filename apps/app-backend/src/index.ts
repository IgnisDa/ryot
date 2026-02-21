import "dotenv/config";
import { Hono } from "hono";
import { auth } from "./utils/auth";

const app = new Hono().basePath("/api");

const route = app
  .on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw))
  .get("/", (c) => {
    return c.text("Hello Hono!");
  });

export type AppType = typeof route;

export default app;
