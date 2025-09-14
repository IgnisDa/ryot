import "dotenv/config";
import { Hono } from "hono";
import { auth, type MaybeAuthType } from "./auth";
import { withSession } from "./auth/middleware";
import { protectedApi } from "./routes/protected";

const app = new Hono<{ Variables: MaybeAuthType }>().basePath("/api");

const route = app
	.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw))
	.use("*", withSession)
	.route("/protected", protectedApi);

export type AppType = typeof route;

export default app;
