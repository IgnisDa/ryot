import "dotenv/config";
import { Hono } from "hono";
import { auth } from "./utils/auth";

const app = new Hono().basePath("/api");

app.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw));

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

export default app;
