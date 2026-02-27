import { Hono } from "hono";
import { auth, type MaybeAuthType } from "~/auth";
import { withSession } from "~/auth/middleware";
import { healthApi } from "~/modules/health/routes";
import { protectedApi } from "~/modules/protected/routes";

export const apiApp = new Hono<{ Variables: MaybeAuthType }>()
	.route("/health", healthApi)
	.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw))
	.use("*", withSession)
	.route("/protected", protectedApi);

export type AppType = typeof apiApp;
